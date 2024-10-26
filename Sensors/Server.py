import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, File, UploadFile
from fastapi.responses import JSONResponse, HTMLResponse, FileResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.requests import Request
from pydantic import BaseModel, ValidationError
import json
import time
import logging
from typing import List
from datetime import datetime
import aiofiles
import os

# Configure logging with DEBUG level for detailed logs
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Define Pydantic model for acceleration data
class AccelerationData(BaseModel):
    x: float
    y: float
    z: float
    timestamp: float

# Variables to control data acquisition
acquisition_started = False
sensor_data: List[dict] = []
data_lock = asyncio.Lock()  # Async lock for thread safety

# Initialize FastAPI
app = FastAPI()

# Ensure the uploads directory exists
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.post("/upload_video")
async def upload_video(file: UploadFile = File(...)):
    # Sanitize the filename to prevent directory traversal attacks
    original_filename = os.path.basename(file.filename)
    timestamp = int(time.time())
    filename = f"recorded_video_{timestamp}.{original_filename.split('.')[-1]}"
    file_location = os.path.join(UPLOAD_DIR, filename)
    try:
        async with aiofiles.open(file_location, 'wb') as out_file:
            content = await file.read()  # async read
            await out_file.write(content)  # async write
        logger.info(f"Video saved to {file_location}.")
        return JSONResponse(content={"status": "Video uploaded", "filename": filename})
    except Exception as e:
        logger.error(f"Error saving video: {e}")
        raise HTTPException(status_code=500, detail="An error occurred while saving the video.")

# Optional: Endpoint to serve uploaded videos
@app.get("/videos/{filename}")
async def get_video(filename: str):
    file_path = os.path.join(UPLOAD_DIR, filename)
    if os.path.exists(file_path):
        return FileResponse(file_path)
    else:
        raise HTTPException(status_code=404, detail="Video not found")

# Mount the static directory (optional)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Initialize templates
templates = Jinja2Templates(directory="templates")

# Connection Manager for Visualization Clients
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info("Visualization client connected.")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info("Visualization client disconnected.")

    async def broadcast(self, message: str):
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception as e:
                logger.error(f"Error sending message to visualization client: {e}")
                disconnected.append(connection)
        for connection in disconnected:
            self.disconnect(connection)

    async def broadcast_json(self, message: dict):
        message_str = json.dumps(message)
        await self.broadcast(message_str)

# Initialize Connection Manager
visualization_manager = ConnectionManager()

# Define maximum number of data points per second
MAX_DATA_POINTS_PER_SECOND = 10
last_data_time = datetime.min


# FastAPI Routes
@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.post("/start")
async def start_acquisition_endpoint():
    global acquisition_started
    async with data_lock:
        acquisition_started = True
    logger.info("Data acquisition started.")
    # Broadcast acquisition started state
    await visualization_manager.broadcast_json({"type": "state", "state": "started"})
    return JSONResponse(content={"status": "Acquisition started"})

@app.post("/stop")
async def stop_acquisition_endpoint():
    global acquisition_started
    async with data_lock:
        acquisition_started = False
    logger.info("Data acquisition stopped.")
    # Broadcast acquisition stopped state
    await visualization_manager.broadcast_json({"type": "state", "state": "stopped"})
    return JSONResponse(content={"status": "Acquisition stopped"})

@app.post("/save")
async def save_data_endpoint():
    global sensor_data
    filename = f"sensor_data_{int(time.time())}.json"
    try:
        async with data_lock:
            async with aiofiles.open(filename, 'w') as f:
                await f.write(json.dumps(sensor_data))
            sensor_data = []  # Clear data after saving
        logger.info(f"Data saved to {filename}.")
        return JSONResponse(content={"status": "Data saved", "filename": filename})
    except Exception as e:
        logger.error(f"Error saving data: {e}")
        raise HTTPException(status_code=500, detail="An error occurred while saving data.")

# Endpoint to handle video uploads
@app.post("/upload_video")
async def upload_video(file: UploadFile = File(...)):
    filename = f"{int(time.time())}_{file.filename}"
    file_location = os.path.join(UPLOAD_DIR, filename)
    try:
        async with aiofiles.open(file_location, 'wb') as out_file:
            content = await file.read()  # async read
            await out_file.write(content)  # async write
        logger.info(f"Video saved to {file_location}.")
        return JSONResponse(content={"status": "Video uploaded", "filename": filename})
    except Exception as e:
        logger.error(f"Error saving video: {e}")
        raise HTTPException(status_code=500, detail="An error occurred while saving the video.")

# WebSocket Endpoint for Receiving Data with Server-Side Throttling
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("Data client connected via WebSocket.")
    global last_data_time
    try:
        while True:
            message = await websocket.receive_text()
            current_time = datetime.utcnow()
            time_diff = (current_time - last_data_time).total_seconds()
            if time_diff < 1 / MAX_DATA_POINTS_PER_SECOND:
                logger.warning("Data rate exceeded. Data point ignored.")
                continue  # Skip processing this data point

            last_data_time = current_time

            logger.debug(f"Raw message received: {message}")
            async with data_lock:
                if acquisition_started:
                    logger.debug("Processing sensor data.")
                    try:
                        data = AccelerationData.parse_raw(message)
                        sensor_data.append(data.dict())  # Add validated data to the list
                        logger.debug(f"Data appended: {data.dict()}")
                        # Broadcast to visualization clients with type "data"
                        await visualization_manager.broadcast_json({
                            "type": "data",
                            "x": data.x,
                            "y": data.y,
                            "z": data.z,
                            "timestamp": data.timestamp
                        })
                        logger.debug("Data broadcasted to visualization clients.")
                    except ValidationError as ve:
                        logger.error(f"Validation error: {ve} - Message: {message}")
                        await websocket.send_text("Error: Data validation failed.")
                else:
                    logger.debug("Acquisition not started. Data ignored.")
    except WebSocketDisconnect as e:
        logger.warning(f"Data client disconnected: {e}")
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        await websocket.close(code=1011, reason="Internal server error")

# WebSocket Endpoint for Visualization Clients with Heartbeat
@app.websocket("/ws_visualization")
async def websocket_visualization(websocket: WebSocket):
    await visualization_manager.connect(websocket)
    try:
        while True:
            # Wait for a heartbeat ping every 30 seconds
            await asyncio.sleep(30)
            await websocket.send_text(json.dumps({"type": "heartbeat"}))
    except WebSocketDisconnect:
        visualization_manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"Unexpected error in visualization WebSocket: {e}")
        await websocket.close(code=1011, reason="Internal server error")

# Serve uploaded videos
@app.get("/videos/{filename}")
async def get_video(filename: str):
    file_path = os.path.join(UPLOAD_DIR, filename)
    if os.path.exists(file_path):
        return FileResponse(file_path)
    else:
        raise HTTPException(status_code=404, detail="Video not found")

# Run FastAPI using Uvicorn
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

