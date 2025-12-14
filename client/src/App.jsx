import React, { useState } from "react";
import { initSignaling } from "./Signaling";
import { createWebRTCConnection, sendFileOverRTC } from "./webrtc";

const statusMessages = {
  "idle": "Ready to start",
  "waiting-for-receiver": "Waiting for receiver to connect...",
  "connecting": "Connecting to sender...",
  "connected": "Connected! Ready to transfer",
  "waiting-for-connection": "Preparing connection...",
  "sending": "Sending file...",
  "receiving": "Receiving file...",
  "sent": "File sent successfully!",
  "received": "File received successfully!"
};

const statusColors = {
  "idle": "bg-gray-100",
  "waiting-for-receiver": "bg-blue-50",
  "connecting": "bg-blue-50",
  "connected": "bg-green-50",
  "waiting-for-connection": "bg-yellow-50",
  "sending": "bg-purple-50",
  "receiving": "bg-purple-50",
  "sent": "bg-green-50",
  "received": "bg-green-50"
};

export default function App() {
  const [mode, setMode] = useState(null);
  const [code, setCode] = useState("");
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [rtc, setRTC] = useState(null);
  const [error, setError] = useState("");
  const [transferredBytes, setTransferredBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [timeoutId, setTimeoutId] = useState(null);

  function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  function clearError() {
    setError("");
  }

  async function startSend() {
    clearError();
    const newCode = generateCode();
    setCode(newCode);
    setMode("send");
    setStatus("waiting-for-receiver");
    setProgress(0);
    setTransferredBytes(0);
    setTotalBytes(0);

    const socket = initSignaling();

    const rtcObj = createWebRTCConnection(
      socket,
      newCode,
      false,
      null,
      null,
      () => {
        console.log("🟢 Sender channel ready");
        setStatus("connected");
        if (timeoutId) clearTimeout(timeoutId);
      }
    );

    setRTC(rtcObj);

    const timeout = setTimeout(() => {
      setError("Connection timeout: Receiver did not connect within 5 minutes");
      setStatus("timeout");
      rtcObj.pc.close();
      socket.disconnect();
    }, 5 * 60 * 1000);

    setTimeoutId(timeout);
  }

  async function sendFile() {
    clearError();
    if (!file) {
      setError("Please select a file first");
      return;
    }

    if (!rtc) {
      setError("Receiver not connected yet");
      return;
    }

    const dc = rtc.getDataChannel();

    if (!dc) {
      setError("DataChannel not ready yet");
      return;
    }

    setTotalBytes(file.size);
    setTransferredBytes(0);

    const progressCallback = (percentComplete, bytesTransferred) => {
      setProgress(percentComplete);
      setTransferredBytes(bytesTransferred);
    };

    if (dc.readyState !== "open") {
      setStatus("waiting-for-connection");
      dc.onopen = async () => {
        setStatus("sending");
        await sendFileOverRTC(file, dc, progressCallback);
        setStatus("sent");
      };
    } else {
      setStatus("sending");
      await sendFileOverRTC(file, dc, progressCallback);
      setStatus("sent");
    }
  }

  async function startReceive() {
    clearError();
    if (code.length !== 6) {
      setError("Please enter a valid 6-digit code");
      return;
    }

    setMode("receive");
    setStatus("connecting");
    setProgress(0);
    setTransferredBytes(0);
    setTotalBytes(0);

    const socket = initSignaling();

    const rtcObj = createWebRTCConnection(
      socket,
      code,
      true,
      (meta, blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = meta.filename;
        a.click();
        URL.revokeObjectURL(url);
        setStatus("received");
        if (timeoutId) clearTimeout(timeoutId);
      },
      (percentComplete, bytesReceived, totalSize) => {
        setProgress(percentComplete);
        setTransferredBytes(bytesReceived);
        setTotalBytes(totalSize);
      },
      () => {
        console.log("🟢 Receiver channel ready");
        setStatus("connected");
        if (timeoutId) clearTimeout(timeoutId);
      }
    );

    setRTC(rtcObj);

    const timeout = setTimeout(() => {
      setError("Connection timeout: Sender did not connect within 5 minutes");
      setStatus("timeout");
      rtcObj.pc.close();
      socket.disconnect();
    }, 5 * 60 * 1000);

    setTimeoutId(timeout);
  }

  function handleReset() {
    if (timeoutId) clearTimeout(timeoutId);
    setMode(null);
    setCode("");
    setFile(null);
    setStatus("idle");
    setProgress(0);
    setError("");
    setTransferredBytes(0);
    setTotalBytes(0);
  }

  return (
    <div className="app-wrapper">
      <div className="container">
        <div className="header">
          <div className="header-content">
            <h1 className="app-title">📤 Send Anywhere Lite</h1>
            <p className="app-subtitle">Fast & secure file transfer</p>
          </div>
        </div>

        {!mode && (
          <div className="welcome-section">
            <div className="welcome-card">
              <h2>What would you like to do?</h2>
              <div className="button-group">
                <button className="btn btn-primary" onClick={startSend}>
                  <span className="btn-icon">📤</span>
                  <span className="btn-text">Send File</span>
                </button>
                <button className="btn btn-secondary" onClick={() => setMode("receive")}>
                  <span className="btn-icon">📥</span>
                  <span className="btn-text">Receive File</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {mode === "send" && (
          <div className="transfer-section">
            <button className="btn-back" onClick={handleReset}>← Back</button>
            <div className={`transfer-card ${statusColors[status]}`}>
              <h2>Send File</h2>
              
              <div className="code-section">
                <p className="code-label">Share this code with the receiver:</p>
                <div className="code-display">{code}</div>
                <button className="btn-copy" onClick={() => {
                  navigator.clipboard.writeText(code);
                  alert("Code copied to clipboard!");
                }}>
                  Copy Code
                </button>
              </div>

              <div className="file-section">
                <label className="file-input-label">
                  <input
                    type="file"
                    onChange={(e) => {
                      setFile(e.target.files[0]);
                      clearError();
                    }}
                    className="file-input"
                  />
                  <span className="file-input-text">
                    {file ? `📄 ${file.name}` : "Choose a file to send"}
                  </span>
                </label>
              </div>

              {error && <div className="error-message">{error}</div>}

              <button 
                className="btn btn-send" 
                onClick={sendFile}
                disabled={!file || status === "sending"}
              >
                {status === "sending" ? "Sending..." : "Send File"}
              </button>

              <div className="status-section">
                <div className="status-item">
                  <span className="status-label">Status:</span>
                  <span className="status-value">{statusMessages[status]}</span>
                </div>
                {(status === "sending" || status === "waiting-for-connection") && (
                  <div className="progress-container">
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                    </div>
                    <div className="progress-details">
                      <span className="progress-text">{Math.round(progress)}%</span>
                      <span className="progress-bytes">
                        {(transferredBytes / (1024 * 1024)).toFixed(2)} MB / {(totalBytes / (1024 * 1024)).toFixed(2)} MB
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {mode === "receive" && (
          <div className="transfer-section">
            <button className="btn-back" onClick={handleReset}>← Back</button>
            <div className={`transfer-card ${statusColors[status]}`}>
              <h2>Receive File</h2>

              <div className="code-input-section">
                <label htmlFor="code-input" className="input-label">Enter the 6-digit code:</label>
                <input
                  id="code-input"
                  type="text"
                  placeholder="000000"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.slice(0, 6));
                    clearError();
                  }}
                  maxLength="6"
                  className="code-input"
                />
              </div>

              {error && <div className="error-message">{error}</div>}

              <button 
                className="btn btn-receive" 
                onClick={startReceive}
                disabled={code.length !== 6 || status === "connecting"}
              >
                {status === "connecting" ? "Connecting..." : "Receive"}
              </button>

              <div className="status-section">
                <div className="status-item">
                  <span className="status-label">Status:</span>
                  <span className="status-value">{statusMessages[status]}</span>
                </div>
                {(status === "receiving" || status === "connecting") && (
                  <div className="progress-container">
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                    </div>
                    <div className="progress-details">
                      <span className="progress-text">{Math.round(progress)}%</span>
                      {totalBytes > 0 && (
                        <span className="progress-bytes">
                          {(transferredBytes / (1024 * 1024)).toFixed(2)} MB / {(totalBytes / (1024 * 1024)).toFixed(2)} MB
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
