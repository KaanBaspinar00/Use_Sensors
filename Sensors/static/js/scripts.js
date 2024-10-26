// =========================
// Data Sender Functionality
// =========================

let senderSocket;
let acquisitionStarted = false;
const senderStatusElement = document.getElementById('status');
const connectBtn = document.getElementById('connectBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const saveBtn = document.getElementById('saveBtn');

// Throttling parameters for data sending
const THROTTLE_INTERVAL = 100; // milliseconds
let lastSendTime = 0;

// Function to connect WebSocket for sending data
function connectSenderWebSocket() {
    // Determine the protocol based on the page's protocol
    let protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}/ws`;

    console.log(`Connecting to WebSocket at ${wsUrl}`);

    senderSocket = new WebSocket(wsUrl);

    senderSocket.onopen = () => {
        senderStatusElement.textContent = 'Connected';
        console.log('WebSocket connection established for data sender.');
        connectBtn.disabled = true;
        startBtn.disabled = false;
        stopBtn.disabled = false;
        saveBtn.disabled = false;

        // Enable video recording controls
        startVideoBtn.disabled = false;
    };

    senderSocket.onmessage = (event) => {
        console.log('Message from server:', event.data);
    };

    senderSocket.onclose = (event) => {
        senderStatusElement.textContent = 'Disconnected';
        console.log(`WebSocket closed: ${event.code} - ${event.reason}`);
        connectBtn.disabled = false;
        startBtn.disabled = true;
        stopBtn.disabled = true;
        saveBtn.disabled = true;

        // Disable video recording controls
        startVideoBtn.disabled = true;
        stopVideoBtn.disabled = true;
        uploadVideoBtn.disabled = true;

        // Attempt to reconnect after a delay
        setTimeout(connectSenderWebSocket, 5000);
    };

    senderSocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        senderSocket.close();
    };
}

// Function to determine supported MIME type
function getSupportedMimeType() {
    const possibleTypes = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4'
    ];

    for (let type of possibleTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
            console.log(`Supported MIME type found: ${type}`);
            return type;
        }
    }
    console.warn('No supported MIME type found for MediaRecorder.');
    return ''; // No supported type found
}

// Function to request permission for DeviceMotionEvent (required on some browsers like Safari on iOS)
async function requestMotionPermission() {
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
            const response = await DeviceMotionEvent.requestPermission();
            if (response === 'granted') {
                console.log('Motion permission granted.');
            } else {
                alert('Permission to access motion sensors denied.');
            }
        } catch (error) {
            console.error('Error requesting motion permission:', error);
        }
    }
}

// Initialize WebSocket connection when the connect button is clicked
connectBtn.addEventListener('click', async () => {
    await requestMotionPermission();
    connectSenderWebSocket();
});

// Function to start data acquisition
async function startAcquisition() {
    acquisitionStarted = true;
    const response = await fetch('/start', { method: 'POST' });
    const data = await response.json();
    alert(data.status);
    console.log('Acquisition started:', data.status);
}

// Function to stop data acquisition
async function stopAcquisition() {
    acquisitionStarted = false;
    const response = await fetch('/stop', { method: 'POST' });
    const data = await response.json();
    alert(data.status);
    console.log('Acquisition stopped:', data.status);
}

// Function to save collected data
async function saveData() {
    const response = await fetch('/save', { method: 'POST' });
    const data = await response.json();
    alert(`Data saved to ${data.filename}`);
    console.log('Data saved:', data.filename);
}

// Add event listeners to buttons
startBtn.addEventListener('click', startAcquisition);
stopBtn.addEventListener('click', stopAcquisition);
saveBtn.addEventListener('click', saveData);

// Listen for DeviceMotionEvent after acquisition starts
if (window.DeviceMotionEvent) {
    window.addEventListener('devicemotion', (event) => {
        if (senderSocket && senderSocket.readyState === WebSocket.OPEN && acquisitionStarted) {
            const currentTime = Date.now();
            if (currentTime - lastSendTime >= THROTTLE_INTERVAL) {
                const acceleration = {
                    x: event.acceleration.x || 0, // Default to 0 if null
                    y: event.acceleration.y || 0,
                    z: event.acceleration.z || 0,
                    timestamp: currentTime  // UNIX epoch time in milliseconds
                };
                senderSocket.send(JSON.stringify(acceleration));
                lastSendTime = currentTime;
                console.log('Data sent:', acceleration);
            }
        }
    }, true);
} else {
    alert('DeviceMotionEvent is not supported on your device/browser.');
}

// =============================
// Visualization Functionality
// =============================

const visualizationStatusElement = document.getElementById('status');
const xAxisSelect = document.getElementById('xAxis');
const yAxisSelect = document.getElementById('yAxis');
const chartDiv = document.getElementById('accelChart');

let visualizationSocket;
let dataBuffer = []; // Buffer to store the latest 200 data points
const BUFFER_SIZE = 200;
let startTime = null; // To adjust timestamp to start from 0
let isAcquisitionRunning = false; // Flag to control plotting

// Initialize Plotly plot with separate traces for X, Y, Z axes
const traceX = {
    x: [],
    y: [],
    mode: 'lines',
    name: 'X-axis',
    line: { color: '#17BECF' }
};
const traceY = {
    x: [],
    y: [],
    mode: 'lines',
    name: 'Y-axis',
    line: { color: '#7F7F7F' }
};
const traceZ = {
    x: [],
    y: [],
    mode: 'lines',
    name: 'Z-axis',
    line: { color: '#B22222' }
};

Plotly.newPlot(chartDiv, [traceX, traceY, traceZ], {
    title: 'Real-Time Accelerometer Data',
    xaxis: { title: 'Timestamp (s)' },
    yaxis: { title: 'Acceleration (m/s²)' }
});

// Function to connect WebSocket for visualization
function connectVisualizationWebSocket() {
    // Determine the protocol based on the page's protocol
    let protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}/ws_visualization`;

    console.log(`Connecting to WebSocket at ${wsUrl}`);

    visualizationSocket = new WebSocket(wsUrl);

    visualizationSocket.onopen = () => {
        visualizationStatusElement.textContent = 'Connected';
        console.log('WebSocket connection established for visualization.');
    };

    visualizationSocket.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            console.log('Received message:', msg);

            if (msg.type === "heartbeat") {
                // Optionally, handle heartbeat messages
                console.log("Heartbeat received from server.");
                return;
            }

            if (msg.type === "data" && isAcquisitionRunning) {
                const currentTime = msg.timestamp;

                // Initialize startTime on first data point after acquisition starts
                if (startTime === null) {
                    startTime = currentTime;
                    console.log(`Start time set to ${startTime}`);
                }

                // Adjust timestamp to start from 0 and convert to seconds
                const adjustedTime = (currentTime - startTime) / 1000;

                // Add new data point to buffer
                dataBuffer.push({
                    timestamp: adjustedTime,
                    x: msg.x,
                    y: msg.y,
                    z: msg.z
                });

                // Maintain buffer size
                if (dataBuffer.length > BUFFER_SIZE) {
                    dataBuffer.shift();
                }

                // Throttle plot updates
                const now = Date.now();
                if (now - lastUpdateTime > updateInterval) {
                    updatePlot();
                    lastUpdateTime = now;
                }
            } else if (msg.type === "state") {
                if (msg.state === "started") {
                    isAcquisitionRunning = true;
                    startTime = null; // Reset start time
                    dataBuffer = []; // Clear buffer
                    Plotly.react(chartDiv, [traceX, traceY, traceZ], {
                        title: 'Real-Time Accelerometer Data',
                        xaxis: { title: 'Timestamp (s)' },
                        yaxis: { title: 'Acceleration (m/s²)' }
                    });
                    console.log("Acquisition started. Plot reset.");
                } else if (msg.state === "stopped") {
                    isAcquisitionRunning = false;
                    console.log("Acquisition stopped. Plot frozen.");
                }
            }
        } catch (error) {
            console.error("Error parsing message:", error);
        }
    };

    visualizationSocket.onclose = (event) => {
        visualizationStatusElement.textContent = 'Disconnected';
        console.log(`WebSocket closed: ${event.code} - ${event.reason}`);
        // Attempt to reconnect after a delay
        setTimeout(connectVisualizationWebSocket, 5000);
    };

    visualizationSocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        visualizationSocket.close();
    };
}

// Function to update the Plotly plot using extendTraces
function updatePlot() {
    const xAxis = xAxisSelect.value;
    const yAxis = yAxisSelect.value;

    // Prepare data for plotting
    const latestPoint = dataBuffer[dataBuffer.length - 1];
    if (!latestPoint) return;

    // Depending on selected axes, map data accordingly
    const xValue = latestPoint[xAxis];
    const yValue = latestPoint[yAxis];

    // Append new data point to the selected traces
    // For simplicity, we append to traceX, traceY, and traceZ
    Plotly.extendTraces(chartDiv, {
        x: [[xValue]],
        y: [[latestPoint.x]]
    }, [0]); // Trace index 0 for X-axis

    Plotly.extendTraces(chartDiv, {
        x: [[xValue]],
        y: [[latestPoint.y]]
    }, [1]); // Trace index 1 for Y-axis

    Plotly.extendTraces(chartDiv, {
        x: [[xValue]],
        y: [[latestPoint.z]]
    }, [2]); // Trace index 2 for Z-axis

    // Optionally, manage the x-axis range to keep the plot focused
    const update = {
        xaxis: {
            range: [xValue - BUFFER_SIZE * 0.05, xValue]  // Adjust as needed
        }
    };
    Plotly.relayout(chartDiv, update);
}

// Throttle plot updates to every 100ms
let updateInterval = 100; // milliseconds
let lastUpdateTime = Date.now();

// Function to get axis label
function getAxisLabel(axis) {
    switch(axis) {
        case 'timestamp':
            return 'Timestamp (s)';
        case 'x':
            return 'X-axis (m/s²)';
        case 'y':
            return 'Y-axis (m/s²)';
        case 'z':
            return 'Z-axis (m/s²)';
        default:
            return '';
    }
}

// Event listeners for axis selection
xAxisSelect.addEventListener('change', () => {
    // Reset plot when axis selection changes
    Plotly.react(chartDiv, [traceX, traceY, traceZ], {
        title: 'Real-Time Accelerometer Data',
        xaxis: { title: getAxisLabel(xAxisSelect.value) },
        yaxis: { title: getAxisLabel(yAxisSelect.value) }
    });
    dataBuffer = []; // Clear buffer
    startTime = null; // Reset start time
    console.log("Axis selection changed. Plot reset.");
});

yAxisSelect.addEventListener('change', () => {
    // Reset plot when axis selection changes
    Plotly.react(chartDiv, [traceX, traceY, traceZ], {
        title: 'Real-Time Accelerometer Data',
        xaxis: { title: getAxisLabel(xAxisSelect.value) },
        yaxis: { title: getAxisLabel(yAxisSelect.value) }
    });
    dataBuffer = []; // Clear buffer
    startTime = null; // Reset start time
    console.log("Axis selection changed. Plot reset.");
});

// Establish WebSocket connection for visualization when the page loads
window.onload = () => {
    connectVisualizationWebSocket();
    // Initialize video stream
    initializeCamera();
};

// =============================
// Video Recorder Functionality
// =============================

const videoStreamElement = document.getElementById('cameraStream');
const recordedVideoElement = document.getElementById('recordedVideo');
const startVideoBtn = document.getElementById('startVideoBtn');
const stopVideoBtn = document.getElementById('stopVideoBtn');
const uploadVideoBtn = document.getElementById('uploadVideoBtn');

let mediaRecorderInstance;
let recordedChunksArray = [];

// Function to initialize camera and display stream
async function initializeCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: "environment" }, // Optimistically request back camera
                width: { ideal: 1280 },               // Optional: Set desired resolution
                height: { ideal: 720 }
            },
            audio: true
        });
        videoStreamElement.srcObject = stream;
        console.log('Camera stream initialized using back camera.');
    } catch (error) {
        console.error('Error accessing back camera:', error);
        alert('Cannot access back camera. Attempting to access any available camera.');

        // Fallback: Attempt to access any available camera
        try {
            const fallbackStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            videoStreamElement.srcObject = fallbackStream;
            console.log('Fallback camera stream initialized.');
        } catch (fallbackError) {
            console.error('Fallback camera access failed:', fallbackError);
            alert('Failed to access any camera.');
        }
    }
}

// Function to start recording video
function startRecording() {
    if (!videoStreamElement.srcObject) {
        alert('No camera stream available.');
        return;
    }

    recordedChunksArray = [];

    // Determine supported MIME type
    const mimeType = getSupportedMimeType();
    if (mimeType === '') {
        alert('No supported video format found for recording.');
        console.error('MediaRecorder: No supported MIME type.');
        return;
    }

    try {
        mediaRecorderInstance = new MediaRecorder(videoStreamElement.srcObject, { mimeType });
    } catch (e) {
        console.error('Exception while creating MediaRecorder:', e);
        alert('MediaRecorder is not supported by your browser.');
        return;
    }

    mediaRecorderInstance.ondataavailable = function(event) {
        if (event.data.size > 0) {
            recordedChunksArray.push(event.data);
            console.log('Data available:', event.data);
        }
    };

    mediaRecorderInstance.onstop = function() {
        const blob = new Blob(recordedChunksArray, { type: mimeType });
        const url = URL.createObjectURL(blob);
        recordedVideoElement.src = url;
        recordedVideoElement.load();
        recordedVideoElement.play();

        // Enable upload button
        uploadVideoBtn.disabled = false;

        console.log('Recording stopped and video ready for upload.');
    };

    mediaRecorderInstance.onerror = function(event) {
        console.error('MediaRecorder error:', event.error);
        alert('An error occurred during recording: ' + event.error.message);
    };

    mediaRecorderInstance.start();
    console.log('Recording started.');
    startVideoBtn.disabled = true;
    stopVideoBtn.disabled = false;
    uploadVideoBtn.disabled = true;
}

// Function to stop recording video
function stopRecording() {
    if (mediaRecorderInstance && mediaRecorderInstance.state !== 'inactive') {
        mediaRecorderInstance.stop();
        console.log('Recording stopped.');
        startVideoBtn.disabled = false;
        stopVideoBtn.disabled = true;
    }
}

// Function to upload and save recorded video
async function uploadVideo() {
    if (recordedChunksArray.length === 0) {
        alert('No video recorded to upload.');
        return;
    }

    const blob = new Blob(recordedChunksArray, { type: mediaRecorderInstance.mimeType });
    const formData = new FormData();
    // Adjust the filename extension based on MIME type
    const fileExtension = mediaRecorderInstance.mimeType.includes('mp4') ? 'mp4' : 'webm';
    formData.append('file', blob, `recorded_video_${Date.now()}.${fileExtension}`);

    try {
        const response = await fetch('/upload_video', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        if (response.ok) {
            alert(`Video uploaded successfully as ${data.filename}`);
            console.log('Video uploaded:', data.filename);
            // Optionally, reset the recorded video element
            recordedVideoElement.src = '';
            recordedVideoElement.load();
            uploadVideoBtn.disabled = true;
        } else {
            alert(`Video upload failed: ${data.detail}`);
            console.error('Video upload failed:', data.detail);
        }
    } catch (error) {
        console.error('Error uploading video:', error);
        alert('An error occurred while uploading the video.');
    }
}

// Add event listeners to video control buttons
startVideoBtn.addEventListener('click', startRecording);
stopVideoBtn.addEventListener('click', stopRecording);
uploadVideoBtn.addEventListener('click', uploadVideo);

// Initialize video recording controls
startVideoBtn.disabled = true; // Enabled after WebSocket connects
stopVideoBtn.disabled = true;
uploadVideoBtn.disabled = true;
