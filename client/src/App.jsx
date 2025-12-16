import React, { useState, useEffect } from "react";
import JSZip from "jszip";
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
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [rtc, setRTC] = useState(null);
  const [error, setError] = useState("");
  const [transferredBytes, setTransferredBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [timeoutId, setTimeoutId] = useState(null);
  const [isReadyToSend, setIsReadyToSend] = useState(false);
  const [toast, setToast] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [timerIntervalId, setTimerIntervalId] = useState(null);

  function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  function clearError() {
    setError("");
  }

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }

  function handleFileSelect(e) {
    const selectedFiles = Array.from(e.target.files);
    setFiles((prevFiles) => [...prevFiles, ...selectedFiles]);
    clearError();
  }

  function deleteFile(index) {
    setFiles((prevFiles) => prevFiles.filter((_, i) => i !== index));
  }

  async function createZipFile() {
    if (files.length === 0) {
      setError("Please select at least one file");
      return null;
    }

    try {
      const zip = new JSZip();
      
      for (const file of files) {
        const arrayBuffer = await file.arrayBuffer();
        zip.file(file.name, arrayBuffer);
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const zipFile = new File([zipBlob], "files.zip", { type: "application/zip" });
      return zipFile;
    } catch (err) {
      setError("Error creating zip file: " + err.message);
      return null;
    }
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
    setTimeRemaining(5 * 60);

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
        if (timerIntervalId) clearInterval(timerIntervalId);
        setTimeRemaining(0);
        setIsReadyToSend(true);
      }
    );

    setRTC(rtcObj);

    const timeout = setTimeout(() => {
      setError("Connection timeout: Receiver did not connect within 5 minutes");
      setStatus("timeout");
      rtcObj.pc.close();
      socket.disconnect();
      if (timerIntervalId) clearInterval(timerIntervalId);
    }, 5 * 60 * 1000);

    setTimeoutId(timeout);

    const intervalId = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(intervalId);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    setTimerIntervalId(intervalId);
  }

  async function performFileSend(fileToSend, rtcObj) {
    if (!fileToSend || !rtcObj) {
      return;
    }

    const dc = rtcObj.getDataChannel();

    if (!dc) {
      return;
    }

    setTotalBytes(fileToSend.size);
    setTransferredBytes(0);

    const progressCallback = (percentComplete, bytesTransferred) => {
      setProgress(percentComplete);
      setTransferredBytes(bytesTransferred);
    };

    if (dc.readyState !== "open") {
      setStatus("waiting-for-connection");
      dc.onopen = async () => {
        setStatus("sending");
        await sendFileOverRTC(fileToSend, dc, progressCallback);
        setStatus("sent");
      };
    } else {
      setStatus("sending");
      await sendFileOverRTC(fileToSend, dc, progressCallback);
      setStatus("sent");
    }
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

    await performFileSend(file, rtc);
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

  useEffect(() => {
    if (isReadyToSend && files.length > 0 && rtc && mode === "send") {
      (async () => {
        const zipFile = await createZipFile();
        if (zipFile) {
          await performFileSend(zipFile, rtc);
        }
      })();
      setIsReadyToSend(false);
    }
  }, [isReadyToSend, files, rtc, mode]);

  function handleReset() {
    if (timeoutId) clearTimeout(timeoutId);
    if (timerIntervalId) clearInterval(timerIntervalId);
    setMode(null);
    setCode("");
    setFiles([]);
    setStatus("idle");
    setProgress(0);
    setError("");
    setTransferredBytes(0);
    setTotalBytes(0);
    setIsReadyToSend(false);
    setTimeRemaining(0);
  }

  return (
    <div className="app-wrapper">
      <div className="container">
        <div className="header">
          <div className="header-content">
            <h1 className="app-title">📤 Send Everywhere Lite</h1>
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
                  showToast("Code copied");
                }}>
                  Copy Code
                </button>
                {timeRemaining > 0 && (
                  <div className="timer-display">
                    ⏱️ Code expires in {Math.floor(timeRemaining / 60)}:{String(timeRemaining % 60).padStart(2, '0')}
                  </div>
                )}
              </div>

              <div className="file-section">
                <label className="file-input-label">
                  <input
                    type="file"
                    multiple
                    onChange={handleFileSelect}
                    className="file-input"
                  />
                  <span className="file-input-text">
                    {files.length === 0 ? "Choose files to send" : `${files.length} file(s) selected`}
                  </span>
                </label>
              </div>

              {files.length > 0 && (
                <div className="files-list">
                  <p className="files-list-title">Selected Files:</p>
                  {files.map((file, index) => (
                    <div key={index} className="file-item">
                      <span className="file-item-name">📄 {file.name}</span>
                      <span className="file-item-size">({(file.size / (1024 * 1024)).toFixed(2)} MB)</span>
                      <button
                        className="btn-delete-file"
                        onClick={() => deleteFile(index)}
                        title="Delete this file"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                          <line x1="10" y1="11" x2="10" y2="17"></line>
                          <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                      </button>
                    </div>
                  ))}
                  <div className="files-total-size">
                    Total: {(files.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024)).toFixed(2)} MB
                  </div>
                </div>
              )}

              {error && <div className="error-message">{error}</div>}

              {status === "connected" && files.length > 0 && (
                <div className="auto-send-message">
                  ✓ Files will be zipped and sent automatically when receiver connects
                </div>
              )}

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
                {totalBytes > 0 && (
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
      </div>
      {toast && (
        <div className="toast-notification">
          {toast}
        </div>
      )}
    </div>
  );
}
