from fastapi import FastAPI, HTTPException, Depends, Header, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
from datetime import datetime, date, timedelta
from bson import ObjectId
from pymongo import MongoClient
import os
import base64
import io
import jwt
import secrets
from PIL import Image
from passlib.context import CryptContext
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
JWT_SECRET = os.getenv("JWT_SECRET", "blueview-secret-key-2025")
JWT_ALGORITHM = "HS256"

client = MongoClient(MONGO_URL)
db = client[DB_NAME]

# Collections
users_collection = db["users"]
workers_collection = db["workers"]
projects_collection = db["projects"]
checkins_collection = db["checkins"]
daily_logs_collection = db["daily_logs"]

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

# Helper to convert ObjectId to string
def serialize_doc(doc):
    if doc is None:
        return None
    doc["id"] = str(doc.pop("_id"))
    return doc

def serialize_docs(docs):
    return [serialize_doc(doc) for doc in docs]

# ============== AUTH HELPERS ==============

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(user_id: str, role: str, email: str) -> str:
    payload = {
        "user_id": user_id,
        "role": role,
        "email": email,
        "exp": datetime.utcnow() + timedelta(days=30)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    payload = decode_token(token)
    user = users_collection.find_one({"_id": ObjectId(payload["user_id"])})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return serialize_doc(user)

async def require_admin(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user

async def require_cp_or_admin(current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "cp"]:
        raise HTTPException(status_code=403, detail="CP or Admin access required")
    return current_user

# ============== MODELS ==============

class UserCreate(BaseModel):
    email: str
    password: str
    name: str
    role: str = "worker"  # admin, cp, worker
    assigned_projects: List[str] = []

class UserLogin(BaseModel):
    email: str
    password: str

class GoogleAuthRequest(BaseModel):
    id_token: str
    email: str
    name: str
    photo_url: Optional[str] = None

class CPCreate(BaseModel):
    email: str
    password: str
    name: str
    assigned_projects: List[str] = []

class WorkerCreate(BaseModel):
    name: str
    trade: str
    company: str
    osha_number: Optional[str] = None
    certifications: List[str] = []
    signature: Optional[str] = None
    photo: Optional[str] = None

class WorkerUpdate(BaseModel):
    name: Optional[str] = None
    trade: Optional[str] = None
    company: Optional[str] = None
    osha_number: Optional[str] = None
    certifications: Optional[List[str]] = None
    signature: Optional[str] = None
    photo: Optional[str] = None

class ProjectCreate(BaseModel):
    name: str
    location: str
    address: Optional[str] = None
    email_distribution: List[str] = []  # Emails to send daily reports

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    address: Optional[str] = None
    email_distribution: Optional[List[str]] = None

class CheckInCreate(BaseModel):
    worker_id: str
    project_id: str

class InspectionData(BaseModel):
    cleanliness: str = "pass"
    safety: str = "pass"
    comments: Optional[str] = None

class PhotoData(BaseModel):
    image: str
    description: Optional[str] = None

class SubcontractorCardCreate(BaseModel):
    company_name: str
    worker_count: int = 0
    photos: List[PhotoData] = []
    work_description: Optional[str] = None
    inspection: InspectionData = InspectionData()

class DailyLogCreate(BaseModel):
    project_id: str
    log_date: str
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
    return {"status": "healthy", "app": "Blueview", "version": "2.0.0"}

# ============== AUTH ENDPOINTS ==============

@app.post("/api/auth/register")
def register_user(user: UserCreate):
    """Register a new user (workers via Google OAuth typically)"""
    existing = users_collection.find_one({"email": user.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user_dict = {
        "email": user.email.lower(),
        "password": hash_password(user.password),
        "name": user.name,
        "role": user.role,
        "assigned_projects": user.assigned_projects,
        "created_at": datetime.utcnow(),
        "worker_passport_id": None,  # Link to worker passport once created
    }
    result = users_collection.insert_one(user_dict)
    user_dict["id"] = str(result.inserted_id)
    
    token = create_access_token(str(result.inserted_id), user.role, user.email.lower())
    
    return {
        "token": token,
        "user": {
            "id": user_dict["id"],
            "email": user_dict["email"],
            "name": user_dict["name"],
            "role": user_dict["role"],
            "has_passport": False
        }
    }

@app.post("/api/auth/login")
def login_user(credentials: UserLogin):
    """Login with email/password (Admin and CP)"""
    user = users_collection.find_one({"email": credentials.email.lower()})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not verify_password(credentials.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    token = create_access_token(str(user["_id"]), user["role"], user["email"])
    
    # Check if worker has passport
    has_passport = user.get("worker_passport_id") is not None
    
    return {
        "token": token,
        "user": {
            "id": str(user["_id"]),
            "email": user["email"],
            "name": user["name"],
            "role": user["role"],
            "has_passport": has_passport,
            "worker_passport_id": user.get("worker_passport_id"),
            "assigned_projects": user.get("assigned_projects", [])
        }
    }

@app.post("/api/auth/google")
def google_auth(data: GoogleAuthRequest):
    """Google OAuth login - auto-assigns Worker role"""
    email = data.email.lower()
    user = users_collection.find_one({"email": email})
    
    if user:
        # Existing user - login
        token = create_access_token(str(user["_id"]), user["role"], email)
        has_passport = user.get("worker_passport_id") is not None
        return {
            "token": token,
            "user": {
                "id": str(user["_id"]),
                "email": user["email"],
                "name": user["name"],
                "role": user["role"],
                "has_passport": has_passport,
                "worker_passport_id": user.get("worker_passport_id"),
                "assigned_projects": user.get("assigned_projects", [])
            },
            "is_new": False
        }
    else:
        # New user - create with worker role
        user_dict = {
            "email": email,
            "password": hash_password(secrets.token_urlsafe(32)),  # Random password for OAuth users
            "name": data.name,
            "role": "worker",
            "photo_url": data.photo_url,
            "google_id": data.id_token[:50],  # Store partial for reference
            "assigned_projects": [],
            "created_at": datetime.utcnow(),
            "worker_passport_id": None,
        }
        result = users_collection.insert_one(user_dict)
        
        token = create_access_token(str(result.inserted_id), "worker", email)
        
        return {
            "token": token,
            "user": {
                "id": str(result.inserted_id),
                "email": email,
                "name": data.name,
                "role": "worker",
                "has_passport": False,
                "worker_passport_id": None,
                "assigned_projects": []
            },
            "is_new": True
        }

@app.get("/api/auth/me")
def get_me(current_user: dict = Depends(get_current_user)):
    """Get current user info"""
    has_passport = current_user.get("worker_passport_id") is not None
    return {
        "id": current_user["id"],
        "email": current_user["email"],
        "name": current_user["name"],
        "role": current_user["role"],
        "has_passport": has_passport,
        "worker_passport_id": current_user.get("worker_passport_id"),
        "assigned_projects": current_user.get("assigned_projects", [])
    }

# ============== ADMIN: USER MANAGEMENT ==============

@app.get("/api/admin/users")
def get_all_users(current_user: dict = Depends(require_admin)):
    """Admin: Get all users"""
    users = list(users_collection.find())
    return [{
        "id": str(u["_id"]),
        "email": u["email"],
        "name": u["name"],
        "role": u["role"],
        "assigned_projects": u.get("assigned_projects", []),
        "created_at": u.get("created_at")
    } for u in users]

@app.post("/api/admin/create-cp")
def create_cp(cp: CPCreate, current_user: dict = Depends(require_admin)):
    """Admin: Create a Competent Person account"""
    existing = users_collection.find_one({"email": cp.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user_dict = {
        "email": cp.email.lower(),
        "password": hash_password(cp.password),
        "name": cp.name,
        "role": "cp",
        "assigned_projects": cp.assigned_projects,
        "created_at": datetime.utcnow(),
        "created_by": current_user["id"],
    }
    result = users_collection.insert_one(user_dict)
    
    return {
        "id": str(result.inserted_id),
        "email": cp.email.lower(),
        "name": cp.name,
        "role": "cp",
        "assigned_projects": cp.assigned_projects
    }

@app.put("/api/admin/users/{user_id}/assign-projects")
def assign_projects_to_user(user_id: str, project_ids: List[str], current_user: dict = Depends(require_admin)):
    """Admin: Assign projects to a CP"""
    try:
        result = users_collection.update_one(
            {"_id": ObjectId(user_id)},
            {"$set": {"assigned_projects": project_ids}}
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="User not found")
        return {"message": "Projects assigned successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/admin/users/{user_id}")
def delete_user(user_id: str, current_user: dict = Depends(require_admin)):
    """Admin: Delete a user"""
    try:
        result = users_collection.delete_one({"_id": ObjectId(user_id)})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="User not found")
        return {"message": "User deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ============== WORKERS (Worker Passport) ==============

@app.post("/api/workers")
def create_worker(worker: WorkerCreate, current_user: dict = Depends(get_current_user)):
    """Create a worker passport - links to user account for workers"""
    worker_dict = worker.model_dump()
    worker_dict["created_at"] = datetime.utcnow()
    worker_dict["updated_at"] = datetime.utcnow()
    worker_dict["user_id"] = current_user["id"] if current_user["role"] == "worker" else None
    
    result = workers_collection.insert_one(worker_dict)
    worker_dict["id"] = str(result.inserted_id)
    if "_id" in worker_dict:
        del worker_dict["_id"]
    
    # Link passport to user account if worker role
    if current_user["role"] == "worker":
        users_collection.update_one(
            {"_id": ObjectId(current_user["id"])},
            {"$set": {"worker_passport_id": str(result.inserted_id)}}
        )
    
    return worker_dict

@app.get("/api/workers")
def get_workers(current_user: dict = Depends(get_current_user)):
    """Get all workers"""
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

@app.get("/api/workers/my-passport")
def get_my_passport(current_user: dict = Depends(get_current_user)):
    """Get current user's worker passport"""
    if not current_user.get("worker_passport_id"):
        return None
    try:
        worker = workers_collection.find_one({"_id": ObjectId(current_user["worker_passport_id"])})
        return serialize_doc(worker) if worker else None
    except:
        return None

@app.put("/api/workers/{worker_id}")
def update_worker(worker_id: str, worker: WorkerUpdate, current_user: dict = Depends(get_current_user)):
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
def delete_worker(worker_id: str, current_user: dict = Depends(require_cp_or_admin)):
    try:
        result = workers_collection.delete_one({"_id": ObjectId(worker_id)})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Worker not found")
        return {"message": "Worker deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ============== PROJECTS ==============

@app.post("/api/projects")
def create_project(project: ProjectCreate, current_user: dict = Depends(require_admin)):
    import uuid
    project_dict = project.model_dump()
    project_dict["qr_code"] = str(uuid.uuid4())[:8].upper()
    project_dict["created_at"] = datetime.utcnow()
    project_dict["updated_at"] = datetime.utcnow()
    project_dict["created_by"] = current_user["id"]
    result = projects_collection.insert_one(project_dict)
    project_dict["id"] = str(result.inserted_id)
    if "_id" in project_dict:
        del project_dict["_id"]
    return project_dict

@app.get("/api/projects")
def get_projects(current_user: dict = Depends(get_current_user)):
    """Get projects - filtered by assignment for CPs"""
    if current_user["role"] == "cp":
        assigned_ids = current_user.get("assigned_projects", [])
        if not assigned_ids:
            return []
        object_ids = [ObjectId(pid) for pid in assigned_ids if ObjectId.is_valid(pid)]
        projects = list(projects_collection.find({"_id": {"$in": object_ids}}))
    else:
        projects = list(projects_collection.find())
    return serialize_docs(projects)

@app.get("/api/projects/{project_id}")
def get_project(project_id: str, current_user: dict = Depends(get_current_user)):
    try:
        # Check access for CP
        if current_user["role"] == "cp":
            if project_id not in current_user.get("assigned_projects", []):
                raise HTTPException(status_code=403, detail="Access denied to this project")
        
        project = projects_collection.find_one({"_id": ObjectId(project_id)})
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        return serialize_doc(project)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/projects/qr/{qr_code}")
def get_project_by_qr(qr_code: str):
    project = projects_collection.find_one({"qr_code": qr_code.upper()})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return serialize_doc(project)

@app.put("/api/projects/{project_id}")
def update_project(project_id: str, project: ProjectUpdate, current_user: dict = Depends(require_admin)):
    try:
        update_data = {k: v for k, v in project.model_dump().items() if v is not None}
        update_data["updated_at"] = datetime.utcnow()
        result = projects_collection.update_one(
            {"_id": ObjectId(project_id)},
            {"$set": update_data}
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Project not found")
        return get_project(project_id, current_user)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str, current_user: dict = Depends(require_admin)):
    try:
        result = projects_collection.delete_one({"_id": ObjectId(project_id)})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Project not found")
        return {"message": "Project deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ============== CHECK-INS ==============

@app.post("/api/checkins")
def create_checkin(checkin: CheckInCreate, current_user: dict = Depends(get_current_user)):
    """Check in a worker - this also 'signs' the daily log"""
    try:
        worker = workers_collection.find_one({"_id": ObjectId(checkin.worker_id)})
        project = projects_collection.find_one({"_id": ObjectId(checkin.project_id)})
        if not worker:
            raise HTTPException(status_code=404, detail="Worker not found")
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    
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
        "worker_signature": worker.get("signature"),  # Store signature for daily log
        "worker_osha": worker.get("osha_number"),
        "project_name": project["name"],
        "check_in_time": datetime.utcnow(),
        "check_out_time": None,
        "checked_in_by": current_user["id"]
    }
    result = checkins_collection.insert_one(checkin_dict)
    checkin_dict["id"] = str(result.inserted_id)
    if "_id" in checkin_dict:
        del checkin_dict["_id"]
    return checkin_dict

@app.post("/api/checkins/{checkin_id}/checkout")
def checkout(checkin_id: str, current_user: dict = Depends(get_current_user)):
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
def get_today_checkins(project_id: str, current_user: dict = Depends(get_current_user)):
    today_start = datetime.combine(date.today(), datetime.min.time())
    checkins = list(checkins_collection.find({
        "project_id": project_id,
        "check_in_time": {"$gte": today_start}
    }))
    return serialize_docs(checkins)

@app.get("/api/checkins/project/{project_id}/active")
def get_active_checkins(project_id: str, current_user: dict = Depends(get_current_user)):
    today_start = datetime.combine(date.today(), datetime.min.time())
    checkins = list(checkins_collection.find({
        "project_id": project_id,
        "check_in_time": {"$gte": today_start},
        "check_out_time": None
    }))
    return serialize_docs(checkins)

@app.get("/api/checkins/stats/{project_id}")
def get_checkin_stats(project_id: str, current_user: dict = Depends(get_current_user)):
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
                "workers": {"$push": {
                    "name": "$worker_name", 
                    "trade": "$worker_trade",
                    "signature": "$worker_signature",
                    "osha": "$worker_osha"
                }}
            }
        }
    ]
    stats = list(checkins_collection.aggregate(pipeline))
    return [{"company": s["_id"], "worker_count": s["count"], "workers": s["workers"]} for s in stats]

# ============== DAILY LOGS ==============

@app.post("/api/daily-logs")
def create_daily_log(daily_log: DailyLogCreate, current_user: dict = Depends(require_cp_or_admin)):
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
    log_dict["created_by"] = current_user["id"]
    result = daily_logs_collection.insert_one(log_dict)
    log_dict["id"] = str(result.inserted_id)
    if "_id" in log_dict:
        del log_dict["_id"]
    return log_dict

@app.get("/api/daily-logs/project/{project_id}")
def get_project_daily_logs(project_id: str, current_user: dict = Depends(get_current_user)):
    logs = list(daily_logs_collection.find({"project_id": project_id}).sort("log_date", -1))
    return serialize_docs(logs)

@app.get("/api/daily-logs/{log_id}")
def get_daily_log(log_id: str, current_user: dict = Depends(get_current_user)):
    try:
        log = daily_logs_collection.find_one({"_id": ObjectId(log_id)})
        if not log:
            raise HTTPException(status_code=404, detail="Daily log not found")
        return serialize_doc(log)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/daily-logs/project/{project_id}/date/{log_date}")
def get_daily_log_by_date(project_id: str, log_date: str, current_user: dict = Depends(get_current_user)):
    log = daily_logs_collection.find_one({
        "project_id": project_id,
        "log_date": log_date
    })
    if not log:
        return None
    return serialize_doc(log)

@app.put("/api/daily-logs/{log_id}")
def update_daily_log(log_id: str, daily_log: DailyLogUpdate, current_user: dict = Depends(require_cp_or_admin)):
    try:
        update_data = {k: v for k, v in daily_log.model_dump().items() if v is not None}
        update_data["updated_at"] = datetime.utcnow()
        
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
        return get_daily_log(log_id, current_user)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/daily-logs/{log_id}/submit")
def submit_daily_log(log_id: str, current_user: dict = Depends(require_cp_or_admin)):
    try:
        result = daily_logs_collection.update_one(
            {"_id": ObjectId(log_id)},
            {"$set": {"status": "submitted", "submitted_at": datetime.utcnow(), "submitted_by": current_user["id"]}}
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Daily log not found")
        return get_daily_log(log_id, current_user)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/daily-logs/{log_id}")
def delete_daily_log(log_id: str, current_user: dict = Depends(require_admin)):
    try:
        result = daily_logs_collection.delete_one({"_id": ObjectId(log_id)})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Daily log not found")
        return {"message": "Daily log deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ============== PDF GENERATION ==============

@app.get("/api/daily-logs/{log_id}/pdf")
def generate_daily_log_pdf(log_id: str, current_user: dict = Depends(get_current_user)):
    """Generate a professional PDF report for the daily log"""
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    
    try:
        log = daily_logs_collection.find_one({"_id": ObjectId(log_id)})
        if not log:
            raise HTTPException(status_code=404, detail="Daily log not found")
        
        project = projects_collection.find_one({"_id": ObjectId(log["project_id"])})
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Get checked-in workers for this day
        log_date = datetime.strptime(log["log_date"], "%Y-%m-%d")
        day_start = datetime.combine(log_date.date(), datetime.min.time())
        day_end = day_start + timedelta(days=1)
        
        checkins = list(checkins_collection.find({
            "project_id": log["project_id"],
            "check_in_time": {"$gte": day_start, "$lt": day_end}
        }))
        
        # Create PDF
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.5*inch, bottomMargin=0.5*inch)
        
        styles = getSampleStyleSheet()
        title_style = ParagraphStyle('Title', parent=styles['Heading1'], fontSize=24, spaceAfter=20, textColor=colors.HexColor('#FF6B00'))
        heading_style = ParagraphStyle('Heading', parent=styles['Heading2'], fontSize=14, spaceAfter=10, textColor=colors.HexColor('#132F4C'))
        normal_style = styles['Normal']
        
        elements = []
        
        # Header
        elements.append(Paragraph("BLUEVIEW", title_style))
        elements.append(Paragraph("Daily Field Report", heading_style))
        elements.append(Spacer(1, 0.2*inch))
        
        # Project Info Table
        project_data = [
            ["Project:", project["name"]],
            ["Location:", project["location"]],
            ["Date:", log["log_date"]],
            ["Weather:", log.get("weather_conditions", "Not recorded")],
            ["Status:", log.get("status", "draft").upper()],
        ]
        project_table = Table(project_data, colWidths=[1.5*inch, 5*inch])
        project_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#132F4C')),
            ('TEXTCOLOR', (0, 0), (0, -1), colors.white),
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('PADDING', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#2D4A6F')),
        ]))
        elements.append(project_table)
        elements.append(Spacer(1, 0.3*inch))
        
        # Workers Present
        elements.append(Paragraph("Workers On-Site", heading_style))
        if checkins:
            worker_data = [["Name", "Trade", "Company", "OSHA #", "Check-In"]]
            for c in checkins:
                check_time = c["check_in_time"].strftime("%I:%M %p") if c.get("check_in_time") else "N/A"
                worker_data.append([
                    c.get("worker_name", "N/A"),
                    c.get("worker_trade", "N/A"),
                    c.get("worker_company", "N/A"),
                    c.get("worker_osha", "N/A"),
                    check_time
                ])
            worker_table = Table(worker_data, colWidths=[1.5*inch, 1.2*inch, 1.5*inch, 1*inch, 1*inch])
            worker_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#FF6B00')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, -1), 9),
                ('PADDING', (0, 0), (-1, -1), 6),
                ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#2D4A6F')),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F5F5F5')]),
            ]))
            elements.append(worker_table)
        else:
            elements.append(Paragraph("No workers checked in for this date.", normal_style))
        elements.append(Spacer(1, 0.3*inch))
        
        # Subcontractor Work Summary
        elements.append(Paragraph("Work Summary by Subcontractor", heading_style))
        for card in log.get("subcontractor_cards", []):
            elements.append(Paragraph(f"<b>{card['company_name']}</b> ({card.get('worker_count', 0)} workers)", normal_style))
            if card.get("work_description"):
                elements.append(Paragraph(f"Work: {card['work_description']}", normal_style))
            inspection = card.get("inspection", {})
            elements.append(Paragraph(f"Cleanliness: {inspection.get('cleanliness', 'N/A').upper()} | Safety: {inspection.get('safety', 'N/A').upper()}", normal_style))
            if inspection.get("comments"):
                elements.append(Paragraph(f"Comments: {inspection['comments']}", normal_style))
            elements.append(Spacer(1, 0.15*inch))
        
        # Notes
        if log.get("notes"):
            elements.append(Paragraph("Additional Notes", heading_style))
            elements.append(Paragraph(log["notes"], normal_style))
        
        # Footer
        elements.append(Spacer(1, 0.5*inch))
        elements.append(Paragraph(f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')} | Blueview Site Operations Hub", 
                                  ParagraphStyle('Footer', parent=normal_style, fontSize=8, textColor=colors.gray)))
        
        doc.build(elements)
        
        pdf_base64 = base64.b64encode(buffer.getvalue()).decode()
        return {
            "pdf_base64": pdf_base64,
            "filename": f"DailyReport_{project['name'].replace(' ', '_')}_{log['log_date']}.pdf"
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")

# ============== IMAGE HANDLING ==============

@app.post("/api/images/compress")
async def compress_image(image_base64: str = Form(...)):
    try:
        if "," in image_base64:
            image_base64 = image_base64.split(",")[1]
        
        image_data = base64.b64decode(image_base64)
        image = Image.open(io.BytesIO(image_data))
        
        max_size = (1200, 1200)
        image.thumbnail(max_size, Image.Resampling.LANCZOS)
        
        if image.mode in ('RGBA', 'P'):
            image = image.convert('RGB')
        
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

# ============== SEED ADMIN ==============

@app.post("/api/setup/init-admin")
def init_admin():
    """Initialize the first admin account (only works if no admin exists)"""
    existing_admin = users_collection.find_one({"role": "admin"})
    if existing_admin:
        raise HTTPException(status_code=400, detail="Admin already exists")
    
    admin_dict = {
        "email": "admin@blueview.com",
        "password": hash_password("admin123"),
        "name": "Site Admin",
        "role": "admin",
        "assigned_projects": [],
        "created_at": datetime.utcnow(),
    }
    result = users_collection.insert_one(admin_dict)
    
    return {
        "message": "Admin created successfully",
        "email": "admin@blueview.com",
        "password": "admin123",
        "note": "Please change the password immediately!"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
