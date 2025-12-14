// webrtc.js

export function createWebRTCConnection(
  socket,
  code,
  isReceiver,
  onFileReceived,
  onProgress,
  onChannelOpen
) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  let dataChannel = null;

  // ---------- SENDER ----------
  if (!isReceiver) {
    dataChannel = pc.createDataChannel("file", { ordered: true });

    dataChannel.onopen = () => {
      console.log("✅ DataChannel OPEN (sender)");
      if (onChannelOpen) onChannelOpen();
    };

    dataChannel.onerror = (e) => {
      console.error("❌ DataChannel error (sender)", e);
    };
  }

  // ---------- RECEIVER ----------
  pc.ondatachannel = (event) => {
    dataChannel = event.channel;

    dataChannel.onopen = () => {
      console.log("✅ DataChannel OPEN (receiver)");
      if (onChannelOpen) onChannelOpen();
    };

    dataChannel.onerror = (e) => {
      console.error("❌ DataChannel error (receiver)", e);
    };

    setupReceive(dataChannel, onFileReceived, onProgress);
  };

  // ---------- ICE ----------
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", {
        code,
        data: { type: "ice", candidate: event.candidate }
      });
    }
  };

  // ---------- SIGNALING ----------
  socket.on("signal", async (data) => {
    try {
      if (data.type === "offer") {
        await pc.setRemoteDescription(data.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("signal", {
          code,
          data: { type: "answer", answer }
        });
      }

      if (data.type === "answer") {
        await pc.setRemoteDescription(data.answer);
      }

      if (data.type === "ice") {
        await pc.addIceCandidate(data.candidate);
      }
    } catch (err) {
      console.error("❌ Signaling error", err);
    }
  });

  // ---------- JOIN ROOM ----------
  socket.emit("join-room", code);

  // ---------- OFFER CREATION ----------
  socket.on("peer-joined", async () => {
    if (!isReceiver) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("signal", {
        code,
        data: { type: "offer", offer }
      });
    }
  });

  return { pc, getDataChannel: () => dataChannel };
}

// =======================================================
// ===================== RECEIVE FILE =====================
// =======================================================

function setupReceive(dc, onFileReceived, onProgress) {
  let meta = null;
  let receivedBytes = 0;
  const chunks = [];

  dc.onmessage = (event) => {
    // Metadata
    if (typeof event.data === "string") {
      meta = JSON.parse(event.data);
      console.log("📦 Receiving file:", meta.filename);
      return;
    }

    // Binary chunk
    chunks.push(event.data);
    receivedBytes += event.data.byteLength;

    if (meta && onProgress) {
      onProgress((receivedBytes / meta.size) * 100, receivedBytes, meta.size);
    }

    // Done
    if (meta && receivedBytes === meta.size) {
      const blob = new Blob(chunks, { type: meta.type });
      onFileReceived(meta, blob);
    }
  };
}

// =======================================================
// ====================== SEND FILE =======================
// =======================================================

export async function sendFileOverRTC(file, dc, setProgress) {
  if (!dc || dc.readyState !== "open") {
    throw new Error("DataChannel is not open");
  }

  // Send metadata
  dc.send(JSON.stringify({
    filename: file.name,
    size: file.size,
    type: file.type
  }));

  const CHUNK_SIZE = 64 * 1024;
  let offset = 0;

  while (offset < file.size) {
    // Backpressure control
    while (dc.bufferedAmount > CHUNK_SIZE * 8) {
      await new Promise((r) => setTimeout(r, 20));
    }

    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const buffer = await slice.arrayBuffer();
    dc.send(buffer);

    offset += CHUNK_SIZE;
    if (setProgress) {
      setProgress((offset / file.size) * 100, offset);
    }
  }

  console.log("✅ File sent completely");
}
