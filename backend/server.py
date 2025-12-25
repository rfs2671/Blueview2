from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, date
from bson import ObjectId
from pymongo import MongoClient
import os
import base64
import io
from PIL import Image
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Blueview API", description="Site Operations Hub Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MongoDB connection
MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "blueview")

client = MongoClient(MONGO_URL)
db = client[DB_NAME]

# Collections
workers_collection = db["workers"]
projects_collection = db["projects"]
checkins_collection = db["checkins"]
daily_logs_collection = db["daily_logs"]

# Helper to convert ObjectId to string
def serialize_doc(doc):
    if doc is None:
        return None
    doc["id"] = str(doc.pop("_id"))
    return doc

def serialize_docs(docs):
    return [serialize_doc(doc) for doc in docs]

# ============== MODELS ==============

class WorkerCreate(BaseModel):
    name: str
    trade: str
    company: str
    osha_number: Optional[str] = None  # OSHA certification number
    certifications: List[str] = []
    signature: Optional[str] = None  # base64 signature image

class WorkerUpdate(BaseModel):
    name: Optional[str] = None
    trade: Optional[str] = None
    company: Optional[str] = None
    osha_number: Optional[str] = None
    certifications: Optional[List[str]] = None
    signature: Optional[str] = None

class ProjectCreate(BaseModel):
    name: str
    location: str
    address: Optional[str] = None

class CheckInCreate(BaseModel):
    worker_id: str
    project_id: str

class InspectionData(BaseModel):
    cleanliness: str = "pass"  # pass or fail
    safety: str = "pass"  # pass or fail
    comments: Optional[str] = None

class PhotoData(BaseModel):
    image: str  # base64
    description: Optional[str] = None
    markup: Optional[str] = None  # base64 markup overlay

class SubcontractorCardCreate(BaseModel):
    company_name: str
    worker_count: int = 0
    photos: List[PhotoData] = []
    work_description: Optional[str] = None
    inspection: InspectionData = InspectionData()

class DailyLogCreate(BaseModel):
    project_id: str
    log_date: str  # ISO date string
    weather_conditions: Optional[str] = None
    subcontractor_cards: List[SubcontractorCardCreate] = []
    notes: Optional[str] = None

class DailyLogUpdate(BaseModel):
    weather_conditions: Optional[str] = None
    subcontractor_cards: Optional[List[SubcontractorCardCreate]] = None
    notes: Optional[str] = None

# ============== HEALTH CHECK ==============

@app.get("/api/health")
def health_check():
    return {"status": "healthy", "app": "Blueview", "version": "1.0.0"}

# ============== WORKERS (Worker Passport) ==============

@app.post("/api/workers")
def create_worker(worker: WorkerCreate):
    worker_dict = worker.model_dump()
    worker_dict["created_at"] = datetime.utcnow()
    worker_dict["updated_at"] = datetime.utcnow()
    result = workers_collection.insert_one(worker_dict)
    worker_dict["id"] = str(result.inserted_id)
    if "_id" in worker_dict:
        del worker_dict["_id"]
    return worker_dict

@app.get("/api/workers")
def get_workers():
    workers = list(workers_collection.find())
    return serialize_docs(workers)

@app.get("/api/workers/{worker_id}")
def get_worker(worker_id: str):
    try:
        worker = workers_collection.find_one({"_id": ObjectId(worker_id)})
        if not worker:
            raise HTTPException(status_code=404, detail="Worker not found")
        return serialize_doc(worker)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.put("/api/workers/{worker_id}")
def update_worker(worker_id: str, worker: WorkerUpdate):
    try:
        update_data = {k: v for k, v in worker.model_dump().items() if v is not None}
        update_data["updated_at"] = datetime.utcnow()
        result = workers_collection.update_one(
            {"_id": ObjectId(worker_id)},
            {"$set": update_data}
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Worker not found")
        return get_worker(worker_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/workers/{worker_id}")
def delete_worker(worker_id: str):
    try:
        result = workers_collection.delete_one({"_id": ObjectId(worker_id)})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Worker not found")
        return {"message": "Worker deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ============== PROJECTS ==============

@app.post("/api/projects")
def create_project(project: ProjectCreate):
    import uuid
    project_dict = project.model_dump()
    project_dict["qr_code"] = str(uuid.uuid4())[:8].upper()  # Short QR code
    project_dict["created_at"] = datetime.utcnow()
    project_dict["updated_at"] = datetime.utcnow()
    result = projects_collection.insert_one(project_dict)
    project_dict["id"] = str(result.inserted_id)
    if "_id" in project_dict:
        del project_dict["_id"]
    return project_dict

@app.get("/api/projects")
def get_projects():
    projects = list(projects_collection.find())
    return serialize_docs(projects)

@app.get("/api/projects/{project_id}")
def get_project(project_id: str):
    try:
        project = projects_collection.find_one({"_id": ObjectId(project_id)})
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        return serialize_doc(project)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/projects/qr/{qr_code}")
def get_project_by_qr(qr_code: str):
    project = projects_collection.find_one({"qr_code": qr_code.upper()})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return serialize_doc(project)

@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str):
    try:
        result = projects_collection.delete_one({"_id": ObjectId(project_id)})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Project not found")
        return {"message": "Project deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ============== CHECK-INS ==============

@app.post("/api/checkins")
def create_checkin(checkin: CheckInCreate):
    # Verify worker and project exist
    try:
        worker = workers_collection.find_one({"_id": ObjectId(checkin.worker_id)})
        project = projects_collection.find_one({"_id": ObjectId(checkin.project_id)})
        if not worker:
            raise HTTPException(status_code=404, detail="Worker not found")
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    # Check if already checked in today
    today_start = datetime.combine(date.today(), datetime.min.time())
    existing = checkins_collection.find_one({
        "worker_id": checkin.worker_id,
        "project_id": checkin.project_id,
        "check_in_time": {"$gte": today_start},
        "check_out_time": None
    })
    
    if existing:
        raise HTTPException(status_code=400, detail="Worker already checked in today")
    
    checkin_dict = {
        "worker_id": checkin.worker_id,
        "project_id": checkin.project_id,
        "worker_name": worker["name"],
        "worker_company": worker["company"],
        "worker_trade": worker["trade"],
        "project_name": project["name"],
        "check_in_time": datetime.utcnow(),
        "check_out_time": None
    }
    result = checkins_collection.insert_one(checkin_dict)
    checkin_dict["id"] = str(result.inserted_id)
    if "_id" in checkin_dict:
        del checkin_dict["_id"]
    return checkin_dict

@app.post("/api/checkins/{checkin_id}/checkout")
def checkout(checkin_id: str):
    try:
        result = checkins_collection.update_one(
            {"_id": ObjectId(checkin_id)},
            {"$set": {"check_out_time": datetime.utcnow()}}
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Check-in not found")
        checkin = checkins_collection.find_one({"_id": ObjectId(checkin_id)})
        return serialize_doc(checkin)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/checkins/project/{project_id}/today")
def get_today_checkins(project_id: str):
    today_start = datetime.combine(date.today(), datetime.min.time())
    checkins = list(checkins_collection.find({
        "project_id": project_id,
        "check_in_time": {"$gte": today_start}
    }))
    return serialize_docs(checkins)

@app.get("/api/checkins/project/{project_id}/active")
def get_active_checkins(project_id: str):
    """Get workers currently on site (checked in but not checked out)"""
    today_start = datetime.combine(date.today(), datetime.min.time())
    checkins = list(checkins_collection.find({
        "project_id": project_id,
        "check_in_time": {"$gte": today_start},
        "check_out_time": None
    }))
    return serialize_docs(checkins)

@app.get("/api/checkins/stats/{project_id}")
def get_checkin_stats(project_id: str):
    """Get worker count by company for subcontractor cards"""
    today_start = datetime.combine(date.today(), datetime.min.time())
    pipeline = [
        {
            "$match": {
                "project_id": project_id,
                "check_in_time": {"$gte": today_start}
            }
        },
        {
            "$group": {
                "_id": "$worker_company",
                "count": {"$sum": 1},
                "workers": {"$push": {"name": "$worker_name", "trade": "$worker_trade"}}
            }
        }
    ]
    stats = list(checkins_collection.aggregate(pipeline))
    return [{"company": s["_id"], "worker_count": s["count"], "workers": s["workers"]} for s in stats]

# ============== DAILY LOGS (Super Daily) ==============

@app.post("/api/daily-logs")
def create_daily_log(daily_log: DailyLogCreate):
    # Check if log already exists for this project and date
    existing = daily_logs_collection.find_one({
        "project_id": daily_log.project_id,
        "log_date": daily_log.log_date
    })
    if existing:
        raise HTTPException(status_code=400, detail="Daily log already exists for this date")
    
    log_dict = daily_log.model_dump()
    log_dict["created_at"] = datetime.utcnow()
    log_dict["updated_at"] = datetime.utcnow()
    log_dict["status"] = "draft"
    result = daily_logs_collection.insert_one(log_dict)
    log_dict["id"] = str(result.inserted_id)
    if "_id" in log_dict:
        del log_dict["_id"]
    return log_dict

@app.get("/api/daily-logs/project/{project_id}")
def get_project_daily_logs(project_id: str):
    logs = list(daily_logs_collection.find({"project_id": project_id}).sort("log_date", -1))
    return serialize_docs(logs)

@app.get("/api/daily-logs/{log_id}")
def get_daily_log(log_id: str):
    try:
        log = daily_logs_collection.find_one({"_id": ObjectId(log_id)})
        if not log:
            raise HTTPException(status_code=404, detail="Daily log not found")
        return serialize_doc(log)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/daily-logs/project/{project_id}/date/{log_date}")
def get_daily_log_by_date(project_id: str, log_date: str):
    log = daily_logs_collection.find_one({
        "project_id": project_id,
        "log_date": log_date
    })
    if not log:
        return None
    return serialize_doc(log)

@app.put("/api/daily-logs/{log_id}")
def update_daily_log(log_id: str, daily_log: DailyLogUpdate):
    try:
        update_data = {k: v for k, v in daily_log.model_dump().items() if v is not None}
        update_data["updated_at"] = datetime.utcnow()
        
        # Convert subcontractor_cards to dict if present
        if "subcontractor_cards" in update_data:
            update_data["subcontractor_cards"] = [
                card.model_dump() if hasattr(card, 'model_dump') else card 
                for card in update_data["subcontractor_cards"]
            ]
        
        result = daily_logs_collection.update_one(
            {"_id": ObjectId(log_id)},
            {"$set": update_data}
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Daily log not found")
        return get_daily_log(log_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/daily-logs/{log_id}/submit")
def submit_daily_log(log_id: str):
    """Submit/finalize a daily log"""
    try:
        result = daily_logs_collection.update_one(
            {"_id": ObjectId(log_id)},
            {"$set": {"status": "submitted", "submitted_at": datetime.utcnow()}}
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Daily log not found")
        return get_daily_log(log_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/daily-logs/{log_id}")
def delete_daily_log(log_id: str):
    try:
        result = daily_logs_collection.delete_one({"_id": ObjectId(log_id)})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Daily log not found")
        return {"message": "Daily log deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ============== IMAGE HANDLING ==============

@app.post("/api/images/compress")
async def compress_image(image_base64: str = Form(...)):
    """Compress a base64 image for storage"""
    try:
        # Decode base64
        if "," in image_base64:
            image_base64 = image_base64.split(",")[1]
        
        image_data = base64.b64decode(image_base64)
        image = Image.open(io.BytesIO(image_data))
        
        # Resize if too large
        max_size = (1200, 1200)
        image.thumbnail(max_size, Image.Resampling.LANCZOS)
        
        # Convert to RGB if necessary
        if image.mode in ('RGBA', 'P'):
            image = image.convert('RGB')
        
        # Compress
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=70, optimize=True)
        
        compressed_base64 = base64.b64encode(buffer.getvalue()).decode()
        return {
            "compressed_image": f"data:image/jpeg;base64,{compressed_base64}",
            "original_size": len(image_data),
            "compressed_size": len(buffer.getvalue())
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Image compression failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
