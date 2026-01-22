from fastapi import FastAPI, HTTPException, Depends, Header, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, date, timedelta
from bson import ObjectId
from pymongo import MongoClient
import os
import base64
import io
import jwt
import secrets
import httpx
import resend
from PIL import Image
from passlib.context import CryptContext
from dotenv import load_dotenv
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

load_dotenv()

app = FastAPI(title="Blueview API", description="Site Operations Hub - Production")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============== CONFIGURATION ==============
MONGO_URL = os.getenv("MONGO_URL")
DB_NAME = os.getenv("DB_NAME", "blueview")
JWT_SECRET = os.getenv("JWT_SECRET", "blueview-production-secret-key-2025")
JWT_ALGORITHM = "HS256"

# Google OAuth
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")

# OpenWeather
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY")

# Resend (Email)
RESEND_API_KEY = os.getenv("RESEND_API_KEY")
if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY

# Dropbox OAuth
DROPBOX_APP_KEY = os.getenv("DROPBOX_APP_KEY")
DROPBOX_APP_SECRET = os.getenv("DROPBOX_APP_SECRET")

# MongoDB connection
client = MongoClient(MONGO_URL)
db = client[DB_NAME]

# Collections
users_collection = db["users"]
workers_collection = db["workers"]
projects_collection = db["projects"]
checkins_collection = db["checkins"]
daily_logs_collection = db["daily_logs"]
documents_collection = db["documents"]
subcontractors_collection = db["subcontractors"]
material_requests_collection = db["material_requests"]
geofence_events_collection = db["geofence_events"]
sms_logs_collection = db["sms_logs"]
dob_daily_logs_collection = db["dob_daily_logs"]
report_settings_collection = db["report_settings"]
trade_mappings_collection = db["trade_mappings"]
nfc_tags_collection = db["nfc_tags"]
generated_reports_collection = db["generated_reports"]
safety_orientations_collection = db["safety_orientations"]
safety_meetings_collection = db["safety_meetings"]

# Twilio Configuration (MOCKED until credentials provided)
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER")

# Radar.io Configuration (MOCKED until credentials provided)
RADAR_API_KEY = os.getenv("RADAR_API_KEY")
RADAR_SECRET_KEY = os.getenv("RADAR_SECRET_KEY")

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

# ============== HELPERS ==============

def serialize_doc(doc):
    if doc is None:
        return None
    doc["id"] = str(doc.pop("_id"))
    return doc

def serialize_docs(docs):
    return [serialize_doc(doc) for doc in docs]

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

async def require_subcontractor_or_admin(current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "subcontractor"]:
        raise HTTPException(status_code=403, detail="Subcontractor or Admin access required")
    return current_user

async def require_cp_or_admin(current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["admin", "cp", "subcontractor"]:
        raise HTTPException(status_code=403, detail="CP, Subcontractor or Admin access required")
    return current_user

async def require_can_edit(current_user: dict = Depends(get_current_user)):
    """Only admin and subcontractor can edit, workers are view-only"""
    if current_user["role"] not in ["admin", "subcontractor"]:
        raise HTTPException(status_code=403, detail="Edit permission denied. Workers have view-only access.")
    return current_user

# Role permissions map
ROLE_PERMISSIONS = {
    "admin": {
        "can_create": True,
        "can_read": True,
        "can_update": True,
        "can_delete": True,
        "can_manage_users": True,
        "can_connect_dropbox": True,
        "can_view_material_requests": True,
        "can_approve_materials": True,
    },
    "subcontractor": {
        "can_create": True,
        "can_read": True,
        "can_update": True,  # Only own workers
        "can_delete": False,
        "can_manage_users": False,
        "can_connect_dropbox": False,
        "can_add_workers": True,
        "can_submit_material_requests": True,
        "can_view_material_requests": True,  # Only own
    },
    "worker": {
        "can_create": False,
        "can_read": True,  # View-only
        "can_update": False,
        "can_delete": False,
        "can_manage_users": False,
        "can_connect_dropbox": False,
        "can_view_documents": True,  # View admin's shared documents
    }
}

# ============== MODELS ==============

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

class WorkerPassportCreate(BaseModel):
    name: str
    trade: str
    company: str
    osha_number: Optional[str] = None
    signature: Optional[str] = None  # base64
    id_photo: Optional[str] = None  # base64 selfie
    osha_card_photo: Optional[str] = None  # base64

class WorkerPassportUpdate(BaseModel):
    name: Optional[str] = None
    trade: Optional[str] = None
    company: Optional[str] = None
    osha_number: Optional[str] = None
    signature: Optional[str] = None
    id_photo: Optional[str] = None
    osha_card_photo: Optional[str] = None

class ProjectCreate(BaseModel):
    name: str
    location: str
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    email_distribution: List[str] = []
    geofence_radius: int = 100  # meters

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    email_distribution: Optional[List[str]] = None
    geofence_radius: Optional[int] = None
    dropbox_folder: Optional[str] = None

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

class ConditionalChecklist(BaseModel):
    scaffolding_active: bool = False
    scaffolding_checklist: Optional[dict] = None
    overhead_protection_active: bool = False
    overhead_protection_checklist: Optional[dict] = None

class DailyLogCreate(BaseModel):
    project_id: str
    log_date: str
    weather_conditions: Optional[str] = None
    temperature: Optional[float] = None
    subcontractor_cards: List[SubcontractorCardCreate] = []
    conditional_checklists: Optional[ConditionalChecklist] = None
    notes: Optional[str] = None

class DailyLogUpdate(BaseModel):
    weather_conditions: Optional[str] = None
    temperature: Optional[float] = None
    subcontractor_cards: Optional[List[SubcontractorCardCreate]] = None
    conditional_checklists: Optional[ConditionalChecklist] = None
    notes: Optional[str] = None

# ============== NEW MODELS FOR RBAC & COMPLIANCE ==============

class SubcontractorCreate(BaseModel):
    """Subcontractor account created by Admin"""
    email: str
    password: str
    company_name: str
    contact_name: str
    phone: str
    trade: str
    assigned_projects: List[str] = []

class SubcontractorUpdate(BaseModel):
    company_name: Optional[str] = None
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    trade: Optional[str] = None
    assigned_projects: Optional[List[str]] = None

class WorkerPhoneCreate(BaseModel):
    """Worker phone added by Subcontractor for SMS check-in"""
    name: str
    phone: str
    trade: str
    osha_30_number: Optional[str] = None
    osha_30_expiry: Optional[str] = None  # ISO date
    sst_number: Optional[str] = None
    sst_expiry: Optional[str] = None  # ISO date
    id_photo: Optional[str] = None  # base64

class MaterialRequestCreate(BaseModel):
    """Material request submitted by Subcontractor"""
    project_id: str
    items: List[dict]  # [{name, quantity, unit, notes}]
    priority: str = "normal"  # low, normal, high, urgent
    needed_by: Optional[str] = None  # ISO date
    notes: Optional[str] = None

class MaterialRequestUpdate(BaseModel):
    status: Optional[str] = None  # pending, approved, ordered, delivered, rejected
    admin_notes: Optional[str] = None
    items: Optional[List[dict]] = None

class GeofenceConfig(BaseModel):
    """Geofence configuration for a project"""
    latitude: float
    longitude: float
    radius: int = 100  # meters
    active: bool = True

class SMSCheckInRequest(BaseModel):
    """Fast login via SMS link"""
    token: str
    latitude: float
    longitude: float

class VirtualPassportCreate(BaseModel):
    """Enhanced Virtual Passport with DOB compliance fields"""
    full_name: str
    phone: str
    id_photo: str  # base64
    osha_30_number: str
    osha_30_expiry: str  # ISO date
    sst_number: Optional[str] = None
    sst_expiry: Optional[str] = None
    trade: str
    company: str
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    signature: Optional[str] = None  # base64

class DOBDailyLogEntry(BaseModel):
    """NYC DOB Daily Log entry for a worker"""
    worker_id: str
    check_in_time: str
    check_out_time: Optional[str] = None
    gps_lat: float
    gps_lng: float
    signature_confirmed: bool = False

# ============== REPORT SETTINGS MODELS ==============

class ReportSettingsCreate(BaseModel):
    """Admin report configuration per project"""
    project_id: str
    email_recipients: List[str]  # List of email addresses
    report_trigger_time: str = "17:00"  # 24hr format, default 5 PM
    auto_send_enabled: bool = True
    include_jobsite_log: bool = True
    include_safety_orientation: bool = True
    include_safety_meeting: bool = True

class TradeMappingCreate(BaseModel):
    """Map trade to legal subcontractor name"""
    trade: str  # e.g., "Framing"
    legal_name: str  # e.g., "ODD LLC"
    
class NFCTagCreate(BaseModel):
    """NFC tag registration for a job site"""
    project_id: str
    tag_id: str  # Unique NFC tag identifier
    location_description: str = ""

class NFCCheckInRequest(BaseModel):
    """Worker check-in via NFC tag - for returning workers"""
    tag_id: str
    worker_id: str
    signature: Optional[str] = None  # base64

class WorkerPassportCreate(BaseModel):
    """Create worker passport from OSHA card OCR"""
    name: str
    osha_number: str
    osha_card_type: str = "10"  # "10" or "30"
    osha_expiry_date: Optional[str] = None
    trade: str = "General Labor"
    company: str = ""
    phone: Optional[str] = None
    emergency_contact: Optional[str] = None
    osha_card_image: Optional[str] = None  # base64

class NFCPassportCheckinRequest(BaseModel):
    """Worker check-in with auto-passport recognition"""
    tag_id: str
    device_passport_id: str  # Worker passport ID stored on device

class SafetyOrientationEntry(BaseModel):
    """Worker safety orientation sign-in"""
    worker_name: str
    signature: str  # base64
    company_name: str
    position: str
    osha_40hr: bool = False
    osha_62hr: bool = False
    osha_card_number: str
    general_info_initials: str
    incident_reporting_initials: str
    ppe_initials: str
    fall_protection_initials: str

class SafetyMeetingEntry(BaseModel):
    """Pre-shift safety meeting attendance"""
    worker_name: str
    osha_number: str
    signature: str  # base64

class SafetyMeetingCreate(BaseModel):
    """Pre-shift safety meeting record"""
    project_id: str
    company: str
    meeting_date: str
    meeting_time: str
    dob_permit_number: Optional[str] = None
    competent_person: str
    daily_activities: str
    safety_concerns: str
    attendees: List[SafetyMeetingEntry]

# ============== HEALTH CHECK ==============

@app.get("/api/health")
def health_check():
    return {"status": "healthy", "app": "Blueview", "version": "3.0.0", "database": "MongoDB Atlas"}

# ============== AUTH ENDPOINTS ==============

@app.post("/api/auth/login")
def login_user(credentials: UserLogin):
    """Login with email/password (Admin and CP)"""
    user = users_collection.find_one({"email": credentials.email.lower()})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not verify_password(credentials.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    token = create_access_token(str(user["_id"]), user["role"], user["email"])
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
    """Google OAuth login - auto-assigns Worker role for new users"""
    email = data.email.lower()
    
    # Verify Google token (in production)
    try:
        if GOOGLE_CLIENT_ID and data.id_token != "demo-google-token":
            idinfo = id_token.verify_oauth2_token(
                data.id_token, 
                google_requests.Request(), 
                GOOGLE_CLIENT_ID
            )
            email = idinfo.get('email', email).lower()
    except Exception as e:
        print(f"Google token verification skipped: {e}")
    
    user = users_collection.find_one({"email": email})
    
    if user:
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
        user_dict = {
            "email": email,
            "password": hash_password(secrets.token_urlsafe(32)),
            "name": data.name,
            "role": "worker",
            "photo_url": data.photo_url,
            "auth_provider": "google",
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
    try:
        result = users_collection.delete_one({"_id": ObjectId(user_id)})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="User not found")
        return {"message": "User deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ============== WORKER PASSPORT ==============

@app.post("/api/workers")
def create_worker_passport(worker: WorkerPassportCreate, current_user: dict = Depends(get_current_user)):
    worker_dict = worker.model_dump()
    worker_dict["created_at"] = datetime.utcnow()
    worker_dict["updated_at"] = datetime.utcnow()
    worker_dict["user_id"] = current_user["id"] if current_user["role"] == "worker" else None
    
    result = workers_collection.insert_one(worker_dict)
    worker_dict["id"] = str(result.inserted_id)
    if "_id" in worker_dict:
        del worker_dict["_id"]
    
    if current_user["role"] == "worker":
        users_collection.update_one(
            {"_id": ObjectId(current_user["id"])},
            {"$set": {"worker_passport_id": str(result.inserted_id)}}
        )
    
    return worker_dict

@app.get("/api/workers")
def get_workers(current_user: dict = Depends(get_current_user)):
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
def update_worker(worker_id: str, worker: WorkerPassportUpdate, current_user: dict = Depends(get_current_user)):
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
    project_dict["dropbox_folder"] = None
    project_dict["dropbox_token"] = None
    result = projects_collection.insert_one(project_dict)
    project_dict["id"] = str(result.inserted_id)
    if "_id" in project_dict:
        del project_dict["_id"]
    return project_dict

@app.get("/api/projects")
def get_projects(current_user: dict = Depends(get_current_user)):
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

# ============== WEATHER API ==============

@app.get("/api/weather")
async def get_weather(lat: float = Query(...), lon: float = Query(...)):
    """Get weather from OpenWeather API"""
    if not OPENWEATHER_API_KEY:
        return {"error": "Weather API not configured"}
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"https://api.openweathermap.org/data/2.5/weather",
                params={
                    "lat": lat,
                    "lon": lon,
                    "appid": OPENWEATHER_API_KEY,
                    "units": "imperial"
                }
            )
            data = response.json()
            
            if response.status_code == 200:
                return {
                    "temperature": data["main"]["temp"],
                    "feels_like": data["main"]["feels_like"],
                    "humidity": data["main"]["humidity"],
                    "conditions": data["weather"][0]["main"],
                    "description": data["weather"][0]["description"],
                    "wind_speed": data["wind"]["speed"],
                    "icon": data["weather"][0]["icon"]
                }
            else:
                return {"error": data.get("message", "Weather fetch failed")}
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/weather/by-location")
async def get_weather_by_location(location: str = Query(...)):
    """Get weather by city name"""
    if not OPENWEATHER_API_KEY:
        return {"error": "Weather API not configured"}
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"https://api.openweathermap.org/data/2.5/weather",
                params={
                    "q": location,
                    "appid": OPENWEATHER_API_KEY,
                    "units": "imperial"
                }
            )
            data = response.json()
            
            if response.status_code == 200:
                return {
                    "temperature": data["main"]["temp"],
                    "feels_like": data["main"]["feels_like"],
                    "humidity": data["main"]["humidity"],
                    "conditions": data["weather"][0]["main"],
                    "description": data["weather"][0]["description"],
                    "wind_speed": data["wind"]["speed"],
                    "icon": data["weather"][0]["icon"]
                }
            else:
                return {"error": data.get("message", "Weather fetch failed")}
    except Exception as e:
        return {"error": str(e)}

# ============== CHECK-INS ==============

@app.post("/api/checkins")
def create_checkin(checkin: CheckInCreate, current_user: dict = Depends(get_current_user)):
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
        "worker_signature": worker.get("signature"),
        "worker_osha": worker.get("osha_number"),
        "worker_id_photo": worker.get("id_photo"),
        "worker_osha_card_photo": worker.get("osha_card_photo"),
        "project_name": project["name"],
        "check_in_time": datetime.utcnow(),
        "check_out_time": None,
        "checked_in_by": current_user["id"],
        "signed_documents": ["daily_log", "pre_shift_meeting"]
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
        {"$match": {"project_id": project_id, "check_in_time": {"$gte": today_start}}},
        {"$group": {
            "_id": "$worker_company",
            "count": {"$sum": 1},
            "workers": {"$push": {
                "name": "$worker_name",
                "trade": "$worker_trade",
                "signature": "$worker_signature",
                "osha": "$worker_osha",
                "id_photo": "$worker_id_photo"
            }}
        }}
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
    log = daily_logs_collection.find_one({"project_id": project_id, "log_date": log_date})
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
        if "conditional_checklists" in update_data and update_data["conditional_checklists"]:
            if hasattr(update_data["conditional_checklists"], 'model_dump'):
                update_data["conditional_checklists"] = update_data["conditional_checklists"].model_dump()
        
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
def submit_daily_log(log_id: str, background_tasks: BackgroundTasks, current_user: dict = Depends(require_cp_or_admin)):
    try:
        result = daily_logs_collection.update_one(
            {"_id": ObjectId(log_id)},
            {"$set": {"status": "submitted", "submitted_at": datetime.utcnow(), "submitted_by": current_user["id"]}}
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Daily log not found")
        
        # Schedule email in background
        background_tasks.add_task(send_daily_report_email, log_id)
        
        return get_daily_log(log_id, current_user)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ============== PDF GENERATION ==============

@app.get("/api/daily-logs/{log_id}/pdf")
def generate_daily_log_pdf(log_id: str, current_user: dict = Depends(get_current_user)):
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
        
        log_date = datetime.strptime(log["log_date"], "%Y-%m-%d")
        day_start = datetime.combine(log_date.date(), datetime.min.time())
        day_end = day_start + timedelta(days=1)
        
        checkins = list(checkins_collection.find({
            "project_id": log["project_id"],
            "check_in_time": {"$gte": day_start, "$lt": day_end}
        }))
        
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.5*inch, bottomMargin=0.5*inch)
        
        styles = getSampleStyleSheet()
        title_style = ParagraphStyle('Title', parent=styles['Heading1'], fontSize=24, spaceAfter=20, textColor=colors.HexColor('#FF6B00'))
        heading_style = ParagraphStyle('Heading', parent=styles['Heading2'], fontSize=14, spaceAfter=10, textColor=colors.HexColor('#132F4C'))
        normal_style = styles['Normal']
        
        elements = []
        
        elements.append(Paragraph("BLUEVIEW", title_style))
        elements.append(Paragraph("Daily Field Report", heading_style))
        elements.append(Spacer(1, 0.2*inch))
        
        weather_text = log.get("weather_conditions", "Not recorded")
        if log.get("temperature"):
            weather_text += f" ({log['temperature']}°F)"
        
        project_data = [
            ["Project:", project["name"]],
            ["Location:", project["location"]],
            ["Date:", log["log_date"]],
            ["Weather:", weather_text],
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
        
        elements.append(Paragraph(f"Workers On-Site ({len(checkins)} total)", heading_style))
        if checkins:
            worker_data = [["Name", "Trade", "Company", "OSHA #", "Check-In", "Signed"]]
            for c in checkins:
                check_time = c["check_in_time"].strftime("%I:%M %p") if c.get("check_in_time") else "N/A"
                signed = "Yes" if c.get("worker_signature") else "No"
                worker_data.append([
                    c.get("worker_name", "N/A"),
                    c.get("worker_trade", "N/A"),
                    c.get("worker_company", "N/A"),
                    c.get("worker_osha", "N/A"),
                    check_time,
                    signed
                ])
            worker_table = Table(worker_data, colWidths=[1.3*inch, 1*inch, 1.3*inch, 0.9*inch, 0.8*inch, 0.5*inch])
            worker_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#FF6B00')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, -1), 8),
                ('PADDING', (0, 0), (-1, -1), 5),
                ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#2D4A6F')),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F5F5F5')]),
            ]))
            elements.append(worker_table)
        elements.append(Spacer(1, 0.3*inch))
        
        elements.append(Paragraph("Work Summary by Subcontractor", heading_style))
        for card in log.get("subcontractor_cards", []):
            elements.append(Paragraph(f"<b>{card['company_name']}</b> ({card.get('worker_count', 0)} workers)", normal_style))
            if card.get("work_description"):
                elements.append(Paragraph(f"Work: {card['work_description']}", normal_style))
            inspection = card.get("inspection", {})
            elements.append(Paragraph(f"Cleanliness: {inspection.get('cleanliness', 'N/A').upper()} | Safety: {inspection.get('safety', 'N/A').upper()}", normal_style))
            elements.append(Spacer(1, 0.15*inch))
        
        if log.get("notes"):
            elements.append(Paragraph("Additional Notes", heading_style))
            elements.append(Paragraph(log["notes"], normal_style))
        
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

# ============== EMAIL DISTRIBUTION ==============

async def send_daily_report_email(log_id: str):
    """Send daily report PDF via Resend"""
    if not RESEND_API_KEY:
        print("Resend API not configured, skipping email")
        return
    
    try:
        log = daily_logs_collection.find_one({"_id": ObjectId(log_id)})
        if not log:
            return
        
        project = projects_collection.find_one({"_id": ObjectId(log["project_id"])})
        if not project:
            return
        
        recipients = project.get("email_distribution", [])
        if not recipients:
            print("No email recipients configured for project")
            return
        
        # Generate PDF (simplified for email)
        pdf_data = generate_pdf_for_email(log, project)
        
        params = {
            "from": "Blueview <reports@blueview.app>",
            "to": recipients,
            "subject": f"Daily Report: {project['name']} - {log['log_date']}",
            "html": f"""
            <h1>Daily Field Report</h1>
            <p><strong>Project:</strong> {project['name']}</p>
            <p><strong>Date:</strong> {log['log_date']}</p>
            <p><strong>Weather:</strong> {log.get('weather_conditions', 'N/A')}</p>
            <p><strong>Status:</strong> {log.get('status', 'draft').upper()}</p>
            <hr>
            <p>Full PDF report attached.</p>
            <p>- Blueview Site Operations Hub</p>
            """,
            "attachments": [{
                "filename": f"DailyReport_{log['log_date']}.pdf",
                "content": pdf_data
            }]
        }
        
        resend.Emails.send(params)
        print(f"Email sent to {recipients}")
        
    except Exception as e:
        print(f"Email send failed: {e}")

def generate_pdf_for_email(log, project):
    """Generate base64 PDF for email attachment"""
    from reportlab.lib.pagesizes import letter
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import inch
    
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter)
    styles = getSampleStyleSheet()
    elements = []
    
    elements.append(Paragraph(f"Daily Report: {project['name']}", styles['Title']))
    elements.append(Paragraph(f"Date: {log['log_date']}", styles['Normal']))
    elements.append(Spacer(1, 0.5*inch))
    elements.append(Paragraph(f"Weather: {log.get('weather_conditions', 'N/A')}", styles['Normal']))
    
    doc.build(elements)
    return base64.b64encode(buffer.getvalue()).decode()

@app.post("/api/projects/{project_id}/send-report")
async def send_project_report(project_id: str, background_tasks: BackgroundTasks, current_user: dict = Depends(require_cp_or_admin)):
    """Manually trigger report email for a project"""
    today = date.today().isoformat()
    log = daily_logs_collection.find_one({"project_id": project_id, "log_date": today})
    
    if not log:
        raise HTTPException(status_code=404, detail="No daily log found for today")
    
    background_tasks.add_task(send_daily_report_email, str(log["_id"]))
    return {"message": "Report email scheduled"}

# ============== DROPBOX INTEGRATION ==============

@app.get("/api/dropbox/auth-url")
def get_dropbox_auth_url(current_user: dict = Depends(require_cp_or_admin)):
    """Generate Dropbox OAuth URL for user to authorize"""
    if not DROPBOX_APP_KEY or not DROPBOX_APP_SECRET:
        raise HTTPException(status_code=400, detail="Dropbox not configured")
    
    from dropbox import DropboxOAuth2FlowNoRedirect
    
    auth_flow = DropboxOAuth2FlowNoRedirect(
        DROPBOX_APP_KEY,
        DROPBOX_APP_SECRET,
        token_access_type='offline'
    )
    authorize_url = auth_flow.start()
    
    # Store auth flow in user session for later use
    users_collection.update_one(
        {"_id": ObjectId(current_user["id"])},
        {"$set": {"dropbox_auth_flow_state": "pending"}}
    )
    
    return {"authorize_url": authorize_url}

@app.post("/api/dropbox/complete-auth")
def complete_dropbox_auth(auth_code: str, current_user: dict = Depends(require_cp_or_admin)):
    """Complete Dropbox OAuth with the authorization code"""
    if not DROPBOX_APP_KEY or not DROPBOX_APP_SECRET:
        raise HTTPException(status_code=400, detail="Dropbox not configured")
    
    from dropbox import DropboxOAuth2FlowNoRedirect
    
    try:
        auth_flow = DropboxOAuth2FlowNoRedirect(
            DROPBOX_APP_KEY,
            DROPBOX_APP_SECRET,
            token_access_type='offline'
        )
        auth_flow.start()  # Required to initialize the flow
        
        oauth_result = auth_flow.finish(auth_code)
        
        # Store tokens securely for user
        users_collection.update_one(
            {"_id": ObjectId(current_user["id"])},
            {"$set": {
                "dropbox_access_token": oauth_result.access_token,
                "dropbox_refresh_token": oauth_result.refresh_token,
                "dropbox_connected": True,
                "dropbox_connected_at": datetime.utcnow()
            }}
        )
        
        return {"message": "Dropbox connected successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Dropbox auth failed: {str(e)}")

@app.post("/api/projects/{project_id}/link-dropbox")
def link_dropbox_to_project(
    project_id: str, 
    folder_path: str,
    current_user: dict = Depends(require_cp_or_admin)
):
    """Link a Dropbox folder to project for document sync"""
    # Check user has connected Dropbox
    user = users_collection.find_one({"_id": ObjectId(current_user["id"])})
    if not user or not user.get("dropbox_connected"):
        raise HTTPException(status_code=400, detail="Please connect your Dropbox account first")
    
    try:
        projects_collection.update_one(
            {"_id": ObjectId(project_id)},
            {"$set": {
                "dropbox_folder": folder_path,
                "dropbox_linked_by": current_user["id"],
                "dropbox_linked_at": datetime.utcnow()
            }}
        )
        return {"message": f"Dropbox folder '{folder_path}' linked to project"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/projects/{project_id}/dropbox-files")
async def get_dropbox_files(project_id: str, current_user: dict = Depends(get_current_user)):
    """List files from linked Dropbox folder"""
    import dropbox
    
    # Get user's Dropbox token
    user = users_collection.find_one({"_id": ObjectId(current_user["id"])})
    if not user or not user.get("dropbox_access_token"):
        raise HTTPException(status_code=400, detail="Dropbox not connected")
    
    project = projects_collection.find_one({"_id": ObjectId(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    folder_path = project.get("dropbox_folder")
    if not folder_path:
        return {"files": [], "message": "No Dropbox folder linked"}
    
    try:
        dbx = dropbox.Dropbox(user["dropbox_access_token"])
        result = dbx.files_list_folder(folder_path)
        
        files = []
        for entry in result.entries:
            files.append({
                "name": entry.name,
                "path": entry.path_display,
                "type": "folder" if isinstance(entry, dropbox.files.FolderMetadata) else "file",
                "size": getattr(entry, 'size', None),
                "modified": str(getattr(entry, 'server_modified', None))
            })
        
        return {"files": files, "folder": folder_path}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Dropbox error: {str(e)}")

@app.get("/api/dropbox/status")
def get_dropbox_status(current_user: dict = Depends(get_current_user)):
    """Check if user has connected Dropbox"""
    user = users_collection.find_one({"_id": ObjectId(current_user["id"])})
    return {
        "connected": user.get("dropbox_connected", False) if user else False,
        "connected_at": user.get("dropbox_connected_at") if user else None
    }

# ============== SAMPLE/DEMO DAILY REPORT ==============

@app.get("/api/demo/sample-report")
def generate_sample_daily_report():
    """Generate a complete sample daily report PDF for demo purposes"""
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage, PageBreak
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    
    # Sample data for demo
    sample_project = {
        "name": "Downtown Tower Phase 2",
        "location": "123 Main Street, New York, NY 10001",
        "qr_code": "DTT-2025"
    }
    
    sample_weather = {
        "temperature": 72,
        "conditions": "Partly Cloudy",
        "humidity": 45,
        "wind_speed": 8
    }
    
    sample_workers = [
        {"name": "John Rodriguez", "trade": "Electrician", "company": "ABC Electric", "osha": "OSH-12345", "check_in": "06:45 AM", "signed": True},
        {"name": "Mike Chen", "trade": "Carpenter", "company": "Pro Framing LLC", "osha": "OSH-23456", "check_in": "06:50 AM", "signed": True},
        {"name": "Sarah Johnson", "trade": "Plumber", "company": "City Plumbing", "osha": "OSH-34567", "check_in": "07:00 AM", "signed": True},
        {"name": "Carlos Martinez", "trade": "HVAC Tech", "company": "Cool Air Systems", "osha": "OSH-45678", "check_in": "07:15 AM", "signed": True},
        {"name": "David Williams", "trade": "Welder", "company": "Steel Works Inc", "osha": "OSH-56789", "check_in": "07:20 AM", "signed": True},
        {"name": "James Brown", "trade": "Mason", "company": "Brick Masters", "osha": "OSH-67890", "check_in": "07:30 AM", "signed": True},
        {"name": "Robert Davis", "trade": "Roofer", "company": "Top Cover Co", "osha": "OSH-78901", "check_in": "07:35 AM", "signed": True},
        {"name": "Lisa Anderson", "trade": "Painter", "company": "Color Pro", "osha": "OSH-89012", "check_in": "07:45 AM", "signed": True},
    ]
    
    sample_subcontractors = [
        {
            "company": "ABC Electric",
            "workers": 2,
            "work": "Completed rough-in wiring for floors 12-14. Installed electrical panels in mechanical room.",
            "cleanliness": "pass",
            "safety": "pass"
        },
        {
            "company": "Pro Framing LLC",
            "workers": 3,
            "work": "Framing completed for units 1201-1208. Started interior wall layout for floor 13.",
            "cleanliness": "pass",
            "safety": "pass"
        },
        {
            "company": "City Plumbing",
            "workers": 2,
            "work": "Installed waste lines for bathrooms on floor 11. Pressure tested supply lines.",
            "cleanliness": "pass",
            "safety": "pass"
        },
        {
            "company": "Cool Air Systems",
            "workers": 1,
            "work": "Ductwork installation 75% complete on floor 10. Started VAV box mounting.",
            "cleanliness": "pass",
            "safety": "pass"
        }
    ]
    
    # Build PDF
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.4*inch, bottomMargin=0.5*inch, leftMargin=0.5*inch, rightMargin=0.5*inch)
    
    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle('Title', parent=styles['Heading1'], fontSize=28, spaceAfter=5, textColor=colors.HexColor('#FF6B00'), alignment=TA_CENTER)
    subtitle_style = ParagraphStyle('Subtitle', parent=styles['Normal'], fontSize=12, textColor=colors.HexColor('#666666'), alignment=TA_CENTER, spaceAfter=20)
    heading_style = ParagraphStyle('Heading', parent=styles['Heading2'], fontSize=14, spaceAfter=10, spaceBefore=15, textColor=colors.HexColor('#132F4C'), borderPadding=5)
    normal_style = styles['Normal']
    small_style = ParagraphStyle('Small', parent=styles['Normal'], fontSize=9, textColor=colors.HexColor('#555555'))
    
    elements = []
    
    # Header
    elements.append(Paragraph("BLUEVIEW", title_style))
    elements.append(Paragraph("Daily Field Report", subtitle_style))
    
    # Report metadata
    report_date = date.today().strftime("%B %d, %Y")
    report_time = datetime.now().strftime("%I:%M %p")
    
    # Project Info Box
    project_data = [
        ["PROJECT", sample_project["name"]],
        ["LOCATION", sample_project["location"]],
        ["DATE", report_date],
        ["REPORT ID", f"RPT-{date.today().strftime('%Y%m%d')}-001"],
        ["GENERATED", f"{report_date} at {report_time}"],
    ]
    project_table = Table(project_data, colWidths=[1.5*inch, 5.5*inch])
    project_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#132F4C')),
        ('TEXTCOLOR', (0, 0), (0, -1), colors.white),
        ('TEXTCOLOR', (1, 0), (1, -1), colors.HexColor('#333333')),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (1, 0), (1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('PADDING', (0, 0), (-1, -1), 10),
        ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#CCCCCC')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    elements.append(project_table)
    elements.append(Spacer(1, 0.25*inch))
    
    # Weather Section
    elements.append(Paragraph("WEATHER CONDITIONS", heading_style))
    weather_data = [
        ["Temperature", "Conditions", "Humidity", "Wind"],
        [f"{sample_weather['temperature']}°F", sample_weather['conditions'], f"{sample_weather['humidity']}%", f"{sample_weather['wind_speed']} mph"]
    ]
    weather_table = Table(weather_data, colWidths=[1.75*inch, 1.75*inch, 1.75*inch, 1.75*inch])
    weather_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#4A90D9')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 11),
        ('PADDING', (0, 0), (-1, -1), 10),
        ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#CCCCCC')),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BACKGROUND', (0, 1), (-1, 1), colors.HexColor('#F5F9FF')),
    ]))
    elements.append(weather_table)
    elements.append(Spacer(1, 0.25*inch))
    
    # Worker Sign-In Ledger
    elements.append(Paragraph(f"WORKER SIGN-IN LEDGER ({len(sample_workers)} Workers)", heading_style))
    worker_data = [["#", "Name", "Trade", "Company", "OSHA #", "Check-In", "Signed"]]
    for i, w in enumerate(sample_workers, 1):
        worker_data.append([
            str(i),
            w["name"],
            w["trade"],
            w["company"],
            w["osha"],
            w["check_in"],
            "✓" if w["signed"] else "✗"
        ])
    
    worker_table = Table(worker_data, colWidths=[0.35*inch, 1.4*inch, 0.95*inch, 1.25*inch, 0.9*inch, 0.8*inch, 0.5*inch])
    worker_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#FF6B00')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('FONTSIZE', (0, 1), (-1, -1), 8),
        ('PADDING', (0, 0), (-1, -1), 6),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CCCCCC')),
        ('ALIGN', (0, 0), (0, -1), 'CENTER'),
        ('ALIGN', (-2, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#FFF8F3')]),
        ('TEXTCOLOR', (-1, 1), (-1, -1), colors.HexColor('#4CAF50')),
    ]))
    elements.append(worker_table)
    elements.append(Spacer(1, 0.3*inch))
    
    # Subcontractor Work Summary
    elements.append(Paragraph("SUBCONTRACTOR WORK SUMMARY", heading_style))
    
    for sub in sample_subcontractors:
        sub_header = [[f"{sub['company']}", f"{sub['workers']} Workers", f"Safety: {sub['safety'].upper()}", f"Clean: {sub['cleanliness'].upper()}"]]
        sub_header_table = Table(sub_header, colWidths=[2.5*inch, 1.25*inch, 1.5*inch, 1.5*inch])
        sub_header_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, 0), colors.HexColor('#132F4C')),
            ('TEXTCOLOR', (0, 0), (0, 0), colors.white),
            ('FONTNAME', (0, 0), (0, 0), 'Helvetica-Bold'),
            ('BACKGROUND', (1, 0), (1, 0), colors.HexColor('#2D4A6F')),
            ('TEXTCOLOR', (1, 0), (1, 0), colors.white),
            ('BACKGROUND', (2, 0), (2, 0), colors.HexColor('#4CAF50')),
            ('TEXTCOLOR', (2, 0), (2, 0), colors.white),
            ('BACKGROUND', (3, 0), (3, 0), colors.HexColor('#4CAF50')),
            ('TEXTCOLOR', (3, 0), (3, 0), colors.white),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('PADDING', (0, 0), (-1, -1), 8),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        elements.append(sub_header_table)
        
        work_desc = [[Paragraph(f"<b>Work Performed:</b> {sub['work']}", small_style)]]
        work_table = Table(work_desc, colWidths=[6.75*inch])
        work_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#F5F5F5')),
            ('PADDING', (0, 0), (-1, -1), 10),
            ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#CCCCCC')),
        ]))
        elements.append(work_table)
        elements.append(Spacer(1, 0.15*inch))
    
    # Site Inspection Summary
    elements.append(Spacer(1, 0.1*inch))
    elements.append(Paragraph("SITE INSPECTION SUMMARY", heading_style))
    inspection_data = [
        ["Inspection Item", "Status", "Notes"],
        ["Housekeeping / Cleanliness", "PASS", "All areas clean and organized"],
        ["PPE Compliance", "PASS", "All workers wearing required PPE"],
        ["Fall Protection", "PASS", "Guardrails and harnesses in place"],
        ["Fire Extinguishers", "PASS", "Inspected and accessible"],
        ["Scaffolding Inspection", "PASS", "Daily inspection completed"],
        ["Electrical Safety", "PASS", "GFCI protection verified"],
    ]
    inspection_table = Table(inspection_data, colWidths=[2.5*inch, 1*inch, 3.25*inch])
    inspection_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#132F4C')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('PADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CCCCCC')),
        ('ALIGN', (1, 0), (1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F5F5F5')]),
        ('TEXTCOLOR', (1, 1), (1, -1), colors.HexColor('#4CAF50')),
        ('FONTNAME', (1, 1), (1, -1), 'Helvetica-Bold'),
    ]))
    elements.append(inspection_table)
    
    # Notes Section
    elements.append(Spacer(1, 0.25*inch))
    elements.append(Paragraph("ADDITIONAL NOTES", heading_style))
    notes_text = """
    • Material delivery scheduled for tomorrow at 7:00 AM - drywall for floors 12-15
    • Crane inspection passed - certified until August 2025
    • Safety meeting held at 6:30 AM - topic: Heat stress prevention
    • No incidents or near-misses reported today
    • Concrete pour for floor 16 scheduled for next Monday
    """
    elements.append(Paragraph(notes_text, small_style))
    
    # Footer
    elements.append(Spacer(1, 0.4*inch))
    footer_style = ParagraphStyle('Footer', parent=styles['Normal'], fontSize=8, textColor=colors.HexColor('#888888'), alignment=TA_CENTER)
    elements.append(Paragraph("─" * 80, footer_style))
    elements.append(Paragraph(f"Generated by Blueview Site Operations Hub | {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}", footer_style))
    elements.append(Paragraph("This report is automatically generated and distributed to project stakeholders.", footer_style))
    
    doc.build(elements)
    
    pdf_base64 = base64.b64encode(buffer.getvalue()).decode()
    return {
        "pdf_base64": pdf_base64,
        "filename": f"BlueviewReport_Sample_{date.today().strftime('%Y%m%d')}.pdf",
        "message": "Sample daily report generated successfully"
    }

@app.post("/api/demo/create-sample-data")
def create_sample_data(current_user: dict = Depends(require_admin)):
    """Create sample project, workers, and daily log for testing"""
    
    # Create sample project
    sample_project = {
        "name": "Downtown Tower Phase 2",
        "location": "New York, NY",
        "address": "123 Main Street, New York, NY 10001",
        "latitude": 40.7128,
        "longitude": -74.0060,
        "email_distribution": ["reports@example.com"],
        "qr_code": "DTT-2025",
        "geofence_radius": 100,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "created_by": current_user["id"],
        "dropbox_folder": None,
        "dropbox_token": None
    }
    
    # Check if project exists
    existing_project = projects_collection.find_one({"name": sample_project["name"]})
    if existing_project:
        project_id = str(existing_project["_id"])
    else:
        result = projects_collection.insert_one(sample_project)
        project_id = str(result.inserted_id)
    
    # Create sample workers
    sample_workers_data = [
        {"name": "John Rodriguez", "trade": "Electrician", "company": "ABC Electric", "osha_number": "OSH-12345"},
        {"name": "Mike Chen", "trade": "Carpenter", "company": "Pro Framing LLC", "osha_number": "OSH-23456"},
        {"name": "Sarah Johnson", "trade": "Plumber", "company": "City Plumbing", "osha_number": "OSH-34567"},
        {"name": "Carlos Martinez", "trade": "HVAC Tech", "company": "Cool Air Systems", "osha_number": "OSH-45678"},
    ]
    
    created_workers = []
    for w in sample_workers_data:
        existing = workers_collection.find_one({"name": w["name"], "company": w["company"]})
        if not existing:
            w["created_at"] = datetime.utcnow()
            w["updated_at"] = datetime.utcnow()
            w["signature"] = None
            w["id_photo"] = None
            w["osha_card_photo"] = None
            w["user_id"] = None
            result = workers_collection.insert_one(w)
            created_workers.append(str(result.inserted_id))
        else:
            created_workers.append(str(existing["_id"]))
    
    # Create sample daily log
    today = date.today().isoformat()
    existing_log = daily_logs_collection.find_one({"project_id": project_id, "log_date": today})
    
    if not existing_log:
        sample_log = {
            "project_id": project_id,
            "log_date": today,
            "weather_conditions": "Partly Cloudy",
            "temperature": 72,
            "subcontractor_cards": [
                {
                    "company_name": "ABC Electric",
                    "worker_count": 2,
                    "work_description": "Completed rough-in wiring for floors 12-14",
                    "photos": [],
                    "inspection": {"cleanliness": "pass", "safety": "pass", "comments": None}
                },
                {
                    "company_name": "Pro Framing LLC",
                    "worker_count": 3,
                    "work_description": "Framing completed for units 1201-1208",
                    "photos": [],
                    "inspection": {"cleanliness": "pass", "safety": "pass", "comments": None}
                }
            ],
            "conditional_checklists": None,
            "notes": "Safety meeting held. No incidents reported.",
            "status": "submitted",
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
            "created_by": current_user["id"]
        }
        daily_logs_collection.insert_one(sample_log)
    
    return {
        "message": "Sample data created successfully",
        "project_id": project_id,
        "workers_created": len(created_workers),
        "daily_log_created": not bool(existing_log)
    }

# ============== SUBCONTRACTOR MANAGEMENT (Admin only) ==============

@app.post("/api/admin/create-subcontractor")
def create_subcontractor(sub: SubcontractorCreate, current_user: dict = Depends(require_admin)):
    """Admin creates a subcontractor account"""
    existing = users_collection.find_one({"email": sub.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user_dict = {
        "email": sub.email.lower(),
        "password": hash_password(sub.password),
        "name": sub.contact_name,
        "role": "subcontractor",
        "company_name": sub.company_name,
        "contact_name": sub.contact_name,
        "phone": sub.phone,
        "trade": sub.trade,
        "assigned_projects": sub.assigned_projects,
        "created_at": datetime.utcnow(),
        "created_by": current_user["id"],
        "workers": [],  # Worker phone numbers managed by this subcontractor
    }
    result = users_collection.insert_one(user_dict)
    
    return {
        "id": str(result.inserted_id),
        "email": sub.email.lower(),
        "company_name": sub.company_name,
        "contact_name": sub.contact_name,
        "role": "subcontractor",
        "assigned_projects": sub.assigned_projects
    }

@app.get("/api/admin/subcontractors")
def get_all_subcontractors(current_user: dict = Depends(require_admin)):
    """Admin gets all subcontractors"""
    subs = list(users_collection.find({"role": "subcontractor"}))
    return [{
        "id": str(s["_id"]),
        "email": s["email"],
        "company_name": s.get("company_name"),
        "contact_name": s.get("contact_name"),
        "phone": s.get("phone"),
        "trade": s.get("trade"),
        "assigned_projects": s.get("assigned_projects", []),
        "workers_count": len(s.get("workers", [])),
        "created_at": s.get("created_at")
    } for s in subs]

@app.put("/api/admin/subcontractors/{sub_id}")
def update_subcontractor(sub_id: str, data: SubcontractorUpdate, current_user: dict = Depends(require_admin)):
    """Admin updates a subcontractor"""
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if update_data:
        update_data["updated_at"] = datetime.utcnow()
        users_collection.update_one(
            {"_id": ObjectId(sub_id), "role": "subcontractor"},
            {"$set": update_data}
        )
    return {"message": "Subcontractor updated"}

@app.delete("/api/admin/subcontractors/{sub_id}")
def delete_subcontractor(sub_id: str, current_user: dict = Depends(require_admin)):
    """Admin deletes a subcontractor"""
    result = users_collection.delete_one({"_id": ObjectId(sub_id), "role": "subcontractor"})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Subcontractor not found")
    return {"message": "Subcontractor deleted"}

# ============== SUBCONTRACTOR: WORKER PHONE MANAGEMENT ==============

@app.post("/api/subcontractor/workers")
def add_worker_phone(worker: WorkerPhoneCreate, current_user: dict = Depends(require_subcontractor_or_admin)):
    """Subcontractor adds a worker's phone for SMS check-in"""
    worker_dict = worker.model_dump()
    worker_dict["subcontractor_id"] = current_user["id"]
    worker_dict["created_at"] = datetime.utcnow()
    worker_dict["sms_check_in_token"] = secrets.token_urlsafe(32)  # Unique token for fast login
    worker_dict["is_whitelisted"] = True
    
    result = workers_collection.insert_one(worker_dict)
    
    # Add to subcontractor's worker list
    users_collection.update_one(
        {"_id": ObjectId(current_user["id"])},
        {"$push": {"workers": str(result.inserted_id)}}
    )
    
    return {
        "id": str(result.inserted_id),
        "name": worker.name,
        "phone": worker.phone,
        "sms_token": worker_dict["sms_check_in_token"]
    }

@app.get("/api/subcontractor/workers")
def get_subcontractor_workers(current_user: dict = Depends(require_subcontractor_or_admin)):
    """Subcontractor gets their workers"""
    if current_user["role"] == "admin":
        workers = list(workers_collection.find())
    else:
        workers = list(workers_collection.find({"subcontractor_id": current_user["id"]}))
    
    return [{
        "id": str(w["_id"]),
        "name": w.get("name"),
        "phone": w.get("phone"),
        "trade": w.get("trade"),
        "osha_30_number": w.get("osha_30_number"),
        "osha_30_expiry": w.get("osha_30_expiry"),
        "sst_number": w.get("sst_number"),
        "sst_expiry": w.get("sst_expiry"),
        "is_whitelisted": w.get("is_whitelisted", True)
    } for w in workers]

@app.put("/api/subcontractor/workers/{worker_id}")
def update_worker_phone(worker_id: str, data: dict, current_user: dict = Depends(require_subcontractor_or_admin)):
    """Subcontractor updates a worker"""
    query = {"_id": ObjectId(worker_id)}
    if current_user["role"] != "admin":
        query["subcontractor_id"] = current_user["id"]
    
    data["updated_at"] = datetime.utcnow()
    result = workers_collection.update_one(query, {"$set": data})
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Worker not found or access denied")
    return {"message": "Worker updated"}

# ============== MATERIAL REQUESTS ==============

@app.post("/api/material-requests")
def create_material_request(request: MaterialRequestCreate, current_user: dict = Depends(require_subcontractor_or_admin)):
    """Subcontractor submits a material request for a project"""
    # Verify project access
    if current_user["role"] == "subcontractor":
        if request.project_id not in current_user.get("assigned_projects", []):
            raise HTTPException(status_code=403, detail="Not assigned to this project")
    
    request_dict = request.model_dump()
    request_dict["subcontractor_id"] = current_user["id"]
    request_dict["subcontractor_company"] = current_user.get("company_name", current_user.get("name"))
    request_dict["status"] = "pending"
    request_dict["created_at"] = datetime.utcnow()
    request_dict["updated_at"] = datetime.utcnow()
    
    result = material_requests_collection.insert_one(request_dict)
    request_dict["id"] = str(result.inserted_id)
    if "_id" in request_dict:
        del request_dict["_id"]
    
    return request_dict

@app.get("/api/material-requests")
def get_material_requests(
    project_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get material requests (Admin sees all, Subcontractor sees own)"""
    query = {}
    
    if current_user["role"] == "subcontractor":
        query["subcontractor_id"] = current_user["id"]
    
    if project_id:
        query["project_id"] = project_id
    if status:
        query["status"] = status
    
    requests = list(material_requests_collection.find(query).sort("created_at", -1))
    return serialize_docs(requests)

@app.get("/api/material-requests/{request_id}")
def get_material_request(request_id: str, current_user: dict = Depends(get_current_user)):
    """Get a specific material request"""
    request = material_requests_collection.find_one({"_id": ObjectId(request_id)})
    if not request:
        raise HTTPException(status_code=404, detail="Request not found")
    
    # Subcontractors can only see their own
    if current_user["role"] == "subcontractor" and request.get("subcontractor_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    return serialize_doc(request)

@app.put("/api/material-requests/{request_id}")
def update_material_request(request_id: str, data: MaterialRequestUpdate, current_user: dict = Depends(require_admin)):
    """Admin updates material request status"""
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    update_data["updated_at"] = datetime.utcnow()
    update_data["updated_by"] = current_user["id"]
    
    result = material_requests_collection.update_one(
        {"_id": ObjectId(request_id)},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Request not found")
    
    return get_material_request(request_id, current_user)

# ============== GEOFENCING (Radar.io - MOCKED) ==============

@app.post("/api/projects/{project_id}/geofence")
def set_project_geofence(project_id: str, config: GeofenceConfig, current_user: dict = Depends(require_admin)):
    """Admin sets geofence for a project"""
    projects_collection.update_one(
        {"_id": ObjectId(project_id)},
        {"$set": {
            "geofence": config.model_dump(),
            "geofence_updated_at": datetime.utcnow()
        }}
    )
    
    # TODO: When Radar.io credentials provided, create geofence in Radar
    if RADAR_API_KEY:
        # Real Radar.io integration would go here
        pass
    
    return {"message": "Geofence configured", "config": config.model_dump()}

@app.get("/api/projects/{project_id}/geofence")
def get_project_geofence(project_id: str, current_user: dict = Depends(get_current_user)):
    """Get geofence config for a project"""
    project = projects_collection.find_one({"_id": ObjectId(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    return project.get("geofence", {"active": False, "message": "Geofence not configured"})

@app.post("/api/geofence/entry-event")
async def handle_geofence_entry(
    phone: str,
    project_id: str,
    latitude: float,
    longitude: float,
    background_tasks: BackgroundTasks
):
    """
    Webhook for geofence entry event (from Radar.io or client-side detection)
    Triggers SMS with fast login link
    """
    # Find worker by phone
    worker = workers_collection.find_one({"phone": phone, "is_whitelisted": True})
    if not worker:
        return {"status": "ignored", "reason": "Phone not whitelisted"}
    
    # Log the geofence event
    event = {
        "worker_id": str(worker["_id"]),
        "project_id": project_id,
        "phone": phone,
        "latitude": latitude,
        "longitude": longitude,
        "event_type": "entry",
        "timestamp": datetime.utcnow(),
        "sms_sent": False
    }
    event_result = geofence_events_collection.insert_one(event)
    
    # Generate fast login token
    fast_login_token = secrets.token_urlsafe(32)
    workers_collection.update_one(
        {"_id": worker["_id"]},
        {"$set": {
            "fast_login_token": fast_login_token,
            "fast_login_expires": datetime.utcnow() + timedelta(hours=12)
        }}
    )
    
    # Schedule SMS
    background_tasks.add_task(
        send_checkin_sms, 
        phone, 
        fast_login_token, 
        project_id,
        str(event_result.inserted_id)
    )
    
    return {
        "status": "processing",
        "event_id": str(event_result.inserted_id),
        "message": "SMS check-in link will be sent"
    }

# ============== SMS CHECK-IN (Twilio - MOCKED) ==============

async def send_checkin_sms(phone: str, token: str, project_id: str, event_id: str):
    """Send SMS with fast login link via Twilio"""
    # Get project name
    project = projects_collection.find_one({"_id": ObjectId(project_id)})
    project_name = project["name"] if project else "Job Site"
    
    # Build fast login URL
    base_url = os.getenv("APP_URL", "https://blueview.app")
    fast_login_url = f"{base_url}/checkin?token={token}&project={project_id}"
    
    message = f"Blueview: You've arrived at {project_name}. Tap to check in: {fast_login_url}"
    
    sms_log = {
        "phone": phone,
        "message": message,
        "project_id": project_id,
        "token": token,
        "event_id": event_id,
        "sent_at": datetime.utcnow(),
        "status": "pending"
    }
    
    if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER:
        # Real Twilio integration
        try:
            from twilio.rest import Client
            client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
            
            twilio_message = client.messages.create(
                body=message,
                from_=TWILIO_PHONE_NUMBER,
                to=phone
            )
            sms_log["status"] = "sent"
            sms_log["twilio_sid"] = twilio_message.sid
        except Exception as e:
            sms_log["status"] = "failed"
            sms_log["error"] = str(e)
    else:
        # MOCKED - credentials not provided
        sms_log["status"] = "mocked"
        sms_log["note"] = "Twilio credentials not configured. SMS would be sent in production."
        print(f"[MOCKED SMS] To: {phone}, Message: {message}")
    
    sms_logs_collection.insert_one(sms_log)
    
    # Update geofence event
    geofence_events_collection.update_one(
        {"_id": ObjectId(event_id)},
        {"$set": {"sms_sent": True, "sms_status": sms_log["status"]}}
    )

@app.post("/api/checkin/fast-login")
def fast_login_checkin(data: SMSCheckInRequest):
    """
    Fast login via SMS link - auto-authenticates worker and logs check-in
    """
    # Find worker by token
    worker = workers_collection.find_one({
        "fast_login_token": data.token,
        "fast_login_expires": {"$gt": datetime.utcnow()}
    })
    
    if not worker:
        raise HTTPException(status_code=401, detail="Invalid or expired check-in link")
    
    # Create JWT for worker
    token = create_access_token(str(worker["_id"]), "worker", worker.get("phone", ""))
    
    # Log check-in with GPS
    checkin = {
        "worker_id": str(worker["_id"]),
        "worker_name": worker.get("name"),
        "worker_phone": worker.get("phone"),
        "latitude": data.latitude,
        "longitude": data.longitude,
        "check_in_time": datetime.utcnow(),
        "check_in_method": "sms_fast_login",
        "gps_confirmed": True
    }
    checkins_collection.insert_one(checkin)
    
    # Invalidate the fast login token
    workers_collection.update_one(
        {"_id": worker["_id"]},
        {"$unset": {"fast_login_token": "", "fast_login_expires": ""}}
    )
    
    return {
        "token": token,
        "worker": {
            "id": str(worker["_id"]),
            "name": worker.get("name"),
            "phone": worker.get("phone"),
            "trade": worker.get("trade")
        },
        "checkin_time": checkin["check_in_time"].isoformat()
    }

# ============== NYC DOB DAILY LOG ==============

@app.post("/api/dob-daily-log/{project_id}")
def create_or_append_dob_log(project_id: str, entry: DOBDailyLogEntry, current_user: dict = Depends(get_current_user)):
    """
    Create or append to NYC DOB Daily Log for a project
    Auto-appends worker credentials when they check in
    """
    today = date.today().isoformat()
    
    # Get or create today's DOB log
    dob_log = dob_daily_logs_collection.find_one({
        "project_id": project_id,
        "log_date": today
    })
    
    # Get worker details
    worker = workers_collection.find_one({"_id": ObjectId(entry.worker_id)})
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    
    worker_entry = {
        "worker_id": entry.worker_id,
        "name": worker.get("name"),
        "trade": worker.get("trade"),
        "company": worker.get("company"),
        "osha_30_number": worker.get("osha_30_number"),
        "osha_30_expiry": worker.get("osha_30_expiry"),
        "sst_number": worker.get("sst_number"),
        "sst_expiry": worker.get("sst_expiry"),
        "check_in_time": entry.check_in_time,
        "check_out_time": entry.check_out_time,
        "gps_lat": entry.gps_lat,
        "gps_lng": entry.gps_lng,
        "signature_confirmed": entry.signature_confirmed
    }
    
    if dob_log:
        # Append to existing log
        dob_daily_logs_collection.update_one(
            {"_id": dob_log["_id"]},
            {
                "$push": {"workers": worker_entry},
                "$set": {"updated_at": datetime.utcnow()}
            }
        )
        return {"message": "Worker appended to DOB log", "log_id": str(dob_log["_id"])}
    else:
        # Create new DOB log
        project = projects_collection.find_one({"_id": ObjectId(project_id)})
        
        new_log = {
            "project_id": project_id,
            "project_name": project["name"] if project else "Unknown",
            "project_address": project.get("address", ""),
            "log_date": today,
            "workers": [worker_entry],
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
            "status": "active",
            "dob_compliant": True
        }
        result = dob_daily_logs_collection.insert_one(new_log)
        return {"message": "DOB log created", "log_id": str(result.inserted_id)}

@app.get("/api/dob-daily-log/{project_id}/{log_date}")
def get_dob_daily_log(project_id: str, log_date: str, current_user: dict = Depends(get_current_user)):
    """Get DOB Daily Log for a specific date"""
    log = dob_daily_logs_collection.find_one({
        "project_id": project_id,
        "log_date": log_date
    })
    
    if not log:
        raise HTTPException(status_code=404, detail="DOB log not found for this date")
    
    return serialize_doc(log)

@app.get("/api/dob-daily-log/{project_id}/export")
def export_dob_log_pdf(project_id: str, log_date: str = None, current_user: dict = Depends(get_current_user)):
    """
    Export NYC DOB compliant Daily Log as PDF
    Format meets NYC DOB site safety requirements
    """
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    
    if not log_date:
        log_date = date.today().isoformat()
    
    log = dob_daily_logs_collection.find_one({
        "project_id": project_id,
        "log_date": log_date
    })
    
    if not log:
        raise HTTPException(status_code=404, detail="No DOB log for this date")
    
    project = projects_collection.find_one({"_id": ObjectId(project_id)})
    
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.5*inch, bottomMargin=0.5*inch)
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle('Title', parent=styles['Heading1'], fontSize=16, alignment=1)
    
    elements = []
    
    # Header
    elements.append(Paragraph("NYC DOB DAILY FIELD LOG", title_style))
    elements.append(Spacer(1, 0.2*inch))
    
    # Project Info
    project_info = [
        ["Project Name:", project["name"] if project else log.get("project_name", "")],
        ["Project Address:", project.get("address", "") if project else log.get("project_address", "")],
        ["Date:", log_date],
        ["Total Workers:", str(len(log.get("workers", [])))],
    ]
    
    info_table = Table(project_info, colWidths=[1.5*inch, 5*inch])
    info_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 0.3*inch))
    
    # Worker Sign-In Log
    elements.append(Paragraph("WORKER SIGN-IN LOG", styles['Heading2']))
    
    worker_header = ["#", "Name", "Trade", "Company", "OSHA 30", "SST", "Time In", "GPS"]
    worker_data = [worker_header]
    
    for i, w in enumerate(log.get("workers", []), 1):
        worker_data.append([
            str(i),
            w.get("name", "N/A"),
            w.get("trade", "N/A"),
            w.get("company", "N/A"),
            w.get("osha_30_number", "N/A"),
            w.get("sst_number", "N/A"),
            w.get("check_in_time", "N/A")[:8] if w.get("check_in_time") else "N/A",
            "✓" if w.get("gps_lat") else "✗"
        ])
    
    worker_table = Table(worker_data, colWidths=[0.4*inch, 1.2*inch, 0.8*inch, 1*inch, 0.8*inch, 0.8*inch, 0.7*inch, 0.4*inch])
    worker_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#003366')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.gray),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F5F5F5')]),
    ]))
    elements.append(worker_table)
    
    # Footer
    elements.append(Spacer(1, 0.5*inch))
    elements.append(Paragraph(
        f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')} | NYC DOB Compliant Format",
        ParagraphStyle('Footer', parent=styles['Normal'], fontSize=8, textColor=colors.gray, alignment=1)
    ))
    
    doc.build(elements)
    
    pdf_base64 = base64.b64encode(buffer.getvalue()).decode()
    return {
        "pdf_base64": pdf_base64,
        "filename": f"DOB_DailyLog_{project_id}_{log_date}.pdf"
    }

# ============== DROPBOX ADMIN IMPERSONATION ==============

@app.get("/api/documents/shared")
def get_shared_documents(project_id: str, current_user: dict = Depends(get_current_user)):
    """
    Workers and Subcontractors view Admin's shared Dropbox documents
    Uses Admin's stored Dropbox token (impersonation)
    """
    # Get admin's Dropbox token
    admin = users_collection.find_one({"role": "admin", "dropbox_access_token": {"$exists": True}})
    if not admin or not admin.get("dropbox_access_token"):
        return {"files": [], "message": "Admin has not connected Dropbox"}
    
    # Get project's linked folder
    project = projects_collection.find_one({"_id": ObjectId(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    folder_path = project.get("dropbox_folder")
    if not folder_path:
        return {"files": [], "message": "No Dropbox folder linked to this project"}
    
    # List files using Admin's token
    try:
        import dropbox
        dbx = dropbox.Dropbox(admin["dropbox_access_token"])
        result = dbx.files_list_folder(folder_path)
        
        files = []
        for entry in result.entries:
            file_info = {
                "name": entry.name,
                "path": entry.path_display,
                "type": "folder" if isinstance(entry, dropbox.files.FolderMetadata) else "file",
            }
            
            # Add file-specific info
            if hasattr(entry, 'size'):
                file_info["size"] = entry.size
            if hasattr(entry, 'server_modified'):
                file_info["modified"] = str(entry.server_modified)
            
            # Check if viewable (PDF/Image)
            if file_info["type"] == "file":
                ext = entry.name.lower().split('.')[-1] if '.' in entry.name else ''
                file_info["viewable"] = ext in ['pdf', 'png', 'jpg', 'jpeg', 'gif']
            
            files.append(file_info)
        
        return {
            "files": files,
            "folder": folder_path,
            "can_edit": current_user["role"] == "admin",  # Workers/subs are view-only
            "can_delete": current_user["role"] == "admin"
        }
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Dropbox error: {str(e)}")

@app.get("/api/documents/view/{project_id}")
async def view_document(project_id: str, file_path: str, current_user: dict = Depends(get_current_user)):
    """
    View a document from Admin's Dropbox (read-only for workers/subs)
    Returns temporary download link
    """
    # Get admin's token
    admin = users_collection.find_one({"role": "admin", "dropbox_access_token": {"$exists": True}})
    if not admin:
        raise HTTPException(status_code=400, detail="Dropbox not configured")
    
    try:
        import dropbox
        dbx = dropbox.Dropbox(admin["dropbox_access_token"])
        
        # Get temporary link
        link = dbx.files_get_temporary_link(file_path)
        
        return {
            "download_url": link.link,
            "filename": file_path.split('/')[-1],
            "expires_in": "4 hours",
            "can_edit": False  # Always read-only for this endpoint
        }
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not get file: {str(e)}")

# ============== SETUP ==============

# Owner master key (in production use secure env variable)
OWNER_MASTER_KEY = "BlueviewOwner2025!"

@app.get("/api/owner/admins")
def get_all_admins():
    """Owner gets all admin accounts (companies)"""
    admins = list(users_collection.find({"role": "admin"}))
    return [{
        "id": str(a["_id"]),
        "email": a["email"],
        "company_name": a.get("company_name", a.get("name", "Unknown")),
        "contact_name": a.get("contact_name", a.get("name", "")),
        "created_at": a.get("created_at", "").isoformat() if a.get("created_at") else "",
        "is_active": a.get("is_active", True)
    } for a in admins]

@app.post("/api/owner/create-admin")
def owner_create_admin(data: dict):
    """Owner creates a new admin account for a paying company"""
    if data.get("owner_key") != OWNER_MASTER_KEY:
        raise HTTPException(status_code=403, detail="Invalid owner credentials")
    
    email = data.get("email", "").lower()
    if not email or not data.get("password") or not data.get("company_name"):
        raise HTTPException(status_code=400, detail="Email, password, and company name required")
    
    existing = users_collection.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    admin_dict = {
        "email": email,
        "password": hash_password(data["password"]),
        "name": data.get("contact_name", "Admin"),
        "company_name": data["company_name"],
        "contact_name": data.get("contact_name", ""),
        "role": "admin",
        "assigned_projects": [],
        "created_at": datetime.utcnow(),
        "is_active": True,
        "created_by_owner": True
    }
    result = users_collection.insert_one(admin_dict)
    
    return {
        "id": str(result.inserted_id),
        "email": email,
        "company_name": data["company_name"],
        "message": "Admin account created successfully"
    }

@app.delete("/api/owner/admins/{admin_id}")
def owner_delete_admin(admin_id: str, owner_key: str):
    """Owner deletes an admin account"""
    if owner_key != OWNER_MASTER_KEY:
        raise HTTPException(status_code=403, detail="Invalid owner credentials")
    
    result = users_collection.delete_one({"_id": ObjectId(admin_id), "role": "admin"})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Admin not found")
    
    return {"message": "Admin account deleted"}

@app.put("/api/owner/admins/{admin_id}")
def owner_update_admin(admin_id: str, data: dict):
    """Owner updates an admin account"""
    if data.get("owner_key") != OWNER_MASTER_KEY:
        raise HTTPException(status_code=403, detail="Invalid owner credentials")
    
    update_data = {}
    if "is_active" in data:
        update_data["is_active"] = data["is_active"]
    if "company_name" in data:
        update_data["company_name"] = data["company_name"]
    if "password" in data:
        update_data["password"] = hash_password(data["password"])
    
    if update_data:
        update_data["updated_at"] = datetime.utcnow()
        users_collection.update_one(
            {"_id": ObjectId(admin_id), "role": "admin"},
            {"$set": update_data}
        )
    
    return {"message": "Admin account updated"}

# ============== REPORT SETTINGS (Admin) ==============

@app.post("/api/projects/{project_id}/report-settings")
def create_report_settings(project_id: str, settings: ReportSettingsCreate, current_user: dict = Depends(require_admin)):
    """Admin configures report settings for a project"""
    settings_dict = settings.model_dump()
    settings_dict["project_id"] = project_id
    settings_dict["admin_id"] = current_user["id"]
    settings_dict["created_at"] = datetime.utcnow()
    settings_dict["updated_at"] = datetime.utcnow()
    
    # Upsert - update if exists, create if not
    report_settings_collection.update_one(
        {"project_id": project_id},
        {"$set": settings_dict},
        upsert=True
    )
    
    return {"message": "Report settings saved", "project_id": project_id}

@app.get("/api/projects/{project_id}/report-settings")
def get_report_settings(project_id: str, current_user: dict = Depends(require_admin)):
    """Get report settings for a project"""
    settings = report_settings_collection.find_one({"project_id": project_id})
    if not settings:
        return {
            "project_id": project_id,
            "email_recipients": [],
            "report_trigger_time": "17:00",
            "auto_send_enabled": True,
            "include_jobsite_log": True,
            "include_safety_orientation": True,
            "include_safety_meeting": True
        }
    return serialize_doc(settings)

# ============== TRADE MAPPINGS (Admin) ==============

@app.post("/api/trade-mappings")
def create_trade_mapping(mapping: TradeMappingCreate, current_user: dict = Depends(require_admin)):
    """Admin creates trade to legal subcontractor name mapping"""
    mapping_dict = mapping.model_dump()
    mapping_dict["admin_id"] = current_user["id"]
    mapping_dict["created_at"] = datetime.utcnow()
    
    # Upsert by trade name
    trade_mappings_collection.update_one(
        {"trade": mapping.trade, "admin_id": current_user["id"]},
        {"$set": mapping_dict},
        upsert=True
    )
    
    return {"message": f"Mapping saved: {mapping.trade} → {mapping.legal_name}"}

@app.get("/api/trade-mappings")
def get_trade_mappings(current_user: dict = Depends(require_admin)):
    """Get all trade mappings for admin"""
    mappings = list(trade_mappings_collection.find({"admin_id": current_user["id"]}))
    return serialize_docs(mappings)

@app.delete("/api/trade-mappings/{mapping_id}")
def delete_trade_mapping(mapping_id: str, current_user: dict = Depends(require_admin)):
    """Delete a trade mapping"""
    trade_mappings_collection.delete_one({"_id": ObjectId(mapping_id), "admin_id": current_user["id"]})
    return {"message": "Mapping deleted"}

# ============== NFC TAG MANAGEMENT ==============

@app.post("/api/nfc-tags")
def register_nfc_tag(tag: NFCTagCreate, current_user: dict = Depends(require_admin)):
    """Admin registers an NFC tag for a job site"""
    existing = nfc_tags_collection.find_one({"tag_id": tag.tag_id})
    if existing:
        raise HTTPException(status_code=400, detail="NFC tag already registered")
    
    tag_dict = tag.model_dump()
    tag_dict["admin_id"] = current_user["id"]
    tag_dict["created_at"] = datetime.utcnow()
    tag_dict["is_active"] = True
    
    result = nfc_tags_collection.insert_one(tag_dict)
    
    return {
        "id": str(result.inserted_id),
        "tag_id": tag.tag_id,
        "project_id": tag.project_id,
        "message": "NFC tag registered successfully"
    }

@app.get("/api/nfc-tags")
def get_nfc_tags(current_user: dict = Depends(require_admin)):
    """Get all NFC tags"""
    tags = list(nfc_tags_collection.find({"admin_id": current_user["id"]}))
    return serialize_docs(tags)

@app.get("/api/nfc-tags/{tag_id}/info")
def get_nfc_tag_info(tag_id: str):
    """Public endpoint - Get project info for NFC tag (used when worker scans)"""
    tag = nfc_tags_collection.find_one({"tag_id": tag_id, "is_active": True})
    if not tag:
        raise HTTPException(status_code=404, detail="NFC tag not found or inactive")
    
    project = projects_collection.find_one({"_id": ObjectId(tag["project_id"])})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    return {
        "tag_id": tag_id,
        "project_id": tag["project_id"],
        "project_name": project["name"],
        "project_address": project.get("address", project.get("location", "")),
        "location_description": tag.get("location_description", "")
    }

# ============== NFC CHECK-IN ==============

@app.post("/api/nfc-checkin")
def nfc_worker_checkin(checkin: NFCCheckInRequest):
    """Worker checks in via NFC tag scan"""
    # Verify NFC tag
    tag = nfc_tags_collection.find_one({"tag_id": checkin.tag_id, "is_active": True})
    if not tag:
        raise HTTPException(status_code=404, detail="Invalid NFC tag")
    
    # Get worker
    worker = workers_collection.find_one({"_id": ObjectId(checkin.worker_id)})
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    
    # Create check-in record
    checkin_record = {
        "worker_id": checkin.worker_id,
        "worker_name": worker.get("name"),
        "worker_trade": worker.get("trade"),
        "worker_company": worker.get("company"),
        "worker_osha_number": worker.get("osha_number") or worker.get("osha_30_number"),
        "project_id": tag["project_id"],
        "nfc_tag_id": checkin.tag_id,
        "check_in_time": datetime.utcnow(),
        "check_out_time": None,
        "signature": checkin.signature,
        "check_in_method": "nfc",
        "date": date.today().isoformat()
    }
    
    result = checkins_collection.insert_one(checkin_record)
    
    return {
        "checkin_id": str(result.inserted_id),
        "worker_name": worker.get("name"),
        "project_id": tag["project_id"],
        "check_in_time": checkin_record["check_in_time"].isoformat(),
        "message": "Check-in successful"
    }

@app.post("/api/nfc-checkout/{checkin_id}")
def nfc_worker_checkout(checkin_id: str, signature: Optional[str] = None):
    """Worker checks out"""
    result = checkins_collection.update_one(
        {"_id": ObjectId(checkin_id), "check_out_time": None},
        {"$set": {
            "check_out_time": datetime.utcnow(),
            "checkout_signature": signature
        }}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Check-in not found or already checked out")
    
    return {"message": "Check-out successful"}

# ============== WORKER PASSPORT SYSTEM ==============

worker_passports_collection = db["worker_passports"]
site_orientations_collection = db["site_orientations"]

class OSHACardOCRRequest(BaseModel):
    """Request to OCR an OSHA card image"""
    image_base64: str  # base64 encoded image

@app.post("/api/passport/ocr-osha-card")
def ocr_osha_card(request: OSHACardOCRRequest):
    """Extract info from OSHA card photo using Gemini Vision"""
    import google.generativeai as genai
    import json
    
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="OCR service not configured")
    
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel('gemini-2.0-flash')
        
        # Decode base64 image
        image_data = base64.b64decode(request.image_base64)
        
        # Create image part for Gemini
        image_part = {
            "mime_type": "image/jpeg",
            "data": image_data
        }
        
        prompt = """You are an expert at reading OSHA safety training cards. 
Extract the following information from this card image and return ONLY a JSON object with these fields:
- name: Full name on the card
- osha_number: The DOL card number or student ID
- card_type: "10" for OSHA 10, "30" for OSHA 30, or "other"
- expiry_date: Expiration date in YYYY-MM-DD format if visible, or null
- issuing_org: The organization that issued the card

Return ONLY valid JSON, no other text or explanation."""

        response = model.generate_content([prompt, image_part])
        response_text = response.text.strip()
        
        # Clean response - remove markdown code blocks if present
        if response_text.startswith("```"):
            response_text = response_text.split("```")[1]
            if response_text.startswith("json"):
                response_text = response_text[4:]
        response_text = response_text.strip()
        
        extracted_data = json.loads(response_text)
        
        return {
            "success": True,
            "data": {
                "name": extracted_data.get("name", ""),
                "osha_number": extracted_data.get("osha_number", ""),
                "card_type": extracted_data.get("card_type", "10"),
                "expiry_date": extracted_data.get("expiry_date"),
                "issuing_org": extracted_data.get("issuing_org", "")
            }
        }
        
    except json.JSONDecodeError:
        return {
            "success": False,
            "error": "Could not parse card information",
            "data": {"name": "", "osha_number": "", "card_type": "10", "expiry_date": None}
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "data": {"name": "", "osha_number": "", "card_type": "10", "expiry_date": None}
        }

@app.post("/api/passport/create")
def create_worker_passport_new(passport: WorkerPassportCreate):
    """Create a new worker passport (one-time registration)"""
    # Check if passport already exists with this OSHA number
    existing = worker_passports_collection.find_one({"osha_number": passport.osha_number})
    if existing:
        # Return existing passport
        return {
            "passport_id": str(existing["_id"]),
            "message": "Passport already exists",
            "is_new": False,
            "passport": serialize_doc(existing)
        }
    
    # Create new passport
    passport_doc = {
        "name": passport.name,
        "osha_number": passport.osha_number,
        "osha_card_type": passport.osha_card_type,
        "osha_expiry_date": passport.osha_expiry_date,
        "trade": passport.trade,
        "company": passport.company,
        "phone": passport.phone,
        "emergency_contact": passport.emergency_contact,
        "osha_card_image": passport.osha_card_image,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "is_active": True,
        "sites_visited": [],  # Track which sites worker has done orientation for
        "total_checkins": 0
    }
    
    result = worker_passports_collection.insert_one(passport_doc)
    passport_doc["_id"] = result.inserted_id
    
    return {
        "passport_id": str(result.inserted_id),
        "message": "Passport created successfully",
        "is_new": True,
        "passport": serialize_doc(passport_doc)
    }

@app.get("/api/passport/{passport_id}")
def get_worker_passport(passport_id: str):
    """Get worker passport by ID"""
    try:
        passport = worker_passports_collection.find_one({"_id": ObjectId(passport_id)})
        if not passport:
            raise HTTPException(status_code=404, detail="Passport not found")
        return serialize_doc(passport)
    except Exception:
        raise HTTPException(status_code=404, detail="Invalid passport ID")

@app.get("/api/passport/by-osha/{osha_number}")
def get_passport_by_osha(osha_number: str):
    """Get worker passport by OSHA number"""
    passport = worker_passports_collection.find_one({"osha_number": osha_number})
    if not passport:
        raise HTTPException(status_code=404, detail="Passport not found")
    return serialize_doc(passport)

@app.post("/api/passport/checkin")
def passport_nfc_checkin(checkin: NFCPassportCheckinRequest):
    """
    Worker checks in using their stored passport - AUTO SIGNS ALL BOOKS
    This is the main endpoint for returning workers
    """
    # Verify NFC tag
    tag = nfc_tags_collection.find_one({"tag_id": checkin.tag_id, "is_active": True})
    if not tag:
        raise HTTPException(status_code=404, detail="Invalid NFC tag")
    
    project_id = tag["project_id"]
    
    # Get worker passport
    try:
        passport = worker_passports_collection.find_one({"_id": ObjectId(checkin.device_passport_id)})
    except:
        raise HTTPException(status_code=404, detail="Invalid passport ID")
    
    if not passport:
        raise HTTPException(status_code=404, detail="Passport not found - please register")
    
    today = date.today().isoformat()
    now = datetime.utcnow()
    
    # Check if already checked in today
    existing_checkin = checkins_collection.find_one({
        "passport_id": checkin.device_passport_id,
        "project_id": project_id,
        "date": today,
        "check_out_time": None
    })
    
    if existing_checkin:
        return {
            "success": True,
            "already_checked_in": True,
            "checkin_id": str(existing_checkin["_id"]),
            "worker_name": passport.get("name"),
            "check_in_time": existing_checkin["check_in_time"].isoformat(),
            "message": f"Welcome back {passport.get('name')}! Already checked in today."
        }
    
    # ========== AUTO-SIGN ALL 3 BOOKS ==========
    
    # 1. DAILY SIGN-IN SHEET (Main check-in record)
    checkin_record = {
        "passport_id": checkin.device_passport_id,
        "worker_id": checkin.device_passport_id,  # For backwards compatibility
        "worker_name": passport.get("name"),
        "worker_trade": passport.get("trade"),
        "worker_company": passport.get("company"),
        "worker_osha_number": passport.get("osha_number"),
        "project_id": project_id,
        "nfc_tag_id": checkin.tag_id,
        "check_in_time": now,
        "check_out_time": None,
        "check_in_method": "nfc_passport",
        "date": today,
        "auto_signed": True
    }
    
    checkin_result = checkins_collection.insert_one(checkin_record)
    
    # 2. SAFETY MEETING / TOOLBOX TALK (Auto-sign for today)
    # Find or create today's safety meeting for this project
    safety_meeting = safety_meetings_collection.find_one({
        "project_id": project_id,
        "meeting_date": today
    })
    
    safety_meeting_signed = False
    if safety_meeting:
        # Add worker to attendees if not already there
        existing_attendee = any(
            a.get("osha_number") == passport.get("osha_number") 
            for a in safety_meeting.get("attendees", [])
        )
        if not existing_attendee:
            safety_meetings_collection.update_one(
                {"_id": safety_meeting["_id"]},
                {"$push": {"attendees": {
                    "worker_name": passport.get("name"),
                    "osha_number": passport.get("osha_number"),
                    "signature": "auto-signed",
                    "signed_at": now.isoformat()
                }}}
            )
            safety_meeting_signed = True
    else:
        # Create a placeholder safety meeting for today
        safety_meetings_collection.insert_one({
            "project_id": project_id,
            "meeting_date": today,
            "meeting_time": now.strftime("%H:%M"),
            "auto_created": True,
            "attendees": [{
                "worker_name": passport.get("name"),
                "osha_number": passport.get("osha_number"),
                "signature": "auto-signed",
                "signed_at": now.isoformat()
            }]
        })
        safety_meeting_signed = True
    
    # 3. SITE ORIENTATION (First visit to this site only)
    site_orientation_needed = project_id not in passport.get("sites_visited", [])
    site_orientation_signed = False
    
    if site_orientation_needed:
        # Record site orientation
        site_orientations_collection.insert_one({
            "passport_id": checkin.device_passport_id,
            "worker_name": passport.get("name"),
            "osha_number": passport.get("osha_number"),
            "project_id": project_id,
            "orientation_date": today,
            "signed_at": now,
            "signature": "auto-signed",
            "acknowledged_items": [
                "general_site_info",
                "emergency_procedures", 
                "ppe_requirements",
                "fall_protection",
                "incident_reporting"
            ]
        })
        
        # Mark site as visited in passport
        worker_passports_collection.update_one(
            {"_id": ObjectId(checkin.device_passport_id)},
            {"$addToSet": {"sites_visited": project_id}}
        )
        site_orientation_signed = True
    
    # Update passport stats
    worker_passports_collection.update_one(
        {"_id": ObjectId(checkin.device_passport_id)},
        {
            "$inc": {"total_checkins": 1},
            "$set": {"last_checkin": now, "last_project_id": project_id}
        }
    )
    
    # Get project name for response
    project = projects_collection.find_one({"_id": ObjectId(project_id)})
    project_name = project.get("name", "Job Site") if project else "Job Site"
    
    return {
        "success": True,
        "already_checked_in": False,
        "checkin_id": str(checkin_result.inserted_id),
        "worker_name": passport.get("name"),
        "project_name": project_name,
        "check_in_time": now.isoformat(),
        "books_signed": {
            "daily_signin": True,
            "safety_meeting": safety_meeting_signed or (safety_meeting is not None),
            "site_orientation": site_orientation_signed,
            "first_visit": site_orientation_needed
        },
        "message": f"Welcome {passport.get('name')}! All books signed automatically."
    }

# ============== SAFETY MEETING ==============

@app.post("/api/safety-meetings")
def create_safety_meeting(meeting: SafetyMeetingCreate, current_user: dict = Depends(get_current_user)):
    """Create pre-shift safety meeting record"""
    meeting_dict = meeting.model_dump()
    meeting_dict["created_by"] = current_user["id"]
    meeting_dict["created_at"] = datetime.utcnow()
    
    result = safety_meetings_collection.insert_one(meeting_dict)
    
    return {"id": str(result.inserted_id), "message": "Safety meeting recorded"}

@app.get("/api/safety-meetings/{project_id}/{meeting_date}")
def get_safety_meeting(project_id: str, meeting_date: str, current_user: dict = Depends(get_current_user)):
    """Get safety meeting for a specific date"""
    meeting = safety_meetings_collection.find_one({
        "project_id": project_id,
        "meeting_date": meeting_date
    })
    if not meeting:
        return None
    return serialize_doc(meeting)

# ============== DAILY REPORT PDF GENERATION ==============

def get_legal_subcontractor_name(trade: str, admin_id: str) -> str:
    """Get legal subcontractor name from trade mapping"""
    mapping = trade_mappings_collection.find_one({"trade": trade, "admin_id": admin_id})
    if mapping:
        return mapping["legal_name"]
    return trade  # Return original trade if no mapping

def generate_jobsite_log_pdf(project_id: str, report_date: str, admin_id: str) -> bytes:
    """Generate NYC DOB Daily Jobsite Log PDF (Form 3301-02)"""
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    
    # Get project info
    project = projects_collection.find_one({"_id": ObjectId(project_id)})
    project_name = project["name"] if project else "Unknown"
    project_address = project.get("address", project.get("location", "")) if project else ""
    
    # Get check-ins for the day
    checkins = list(checkins_collection.find({
        "project_id": project_id,
        "date": report_date
    }))
    
    # Get weather
    weather_info = "N/A"
    if OPENWEATHER_API_KEY and project:
        try:
            lat = project.get("latitude", 40.7128)
            lon = project.get("longitude", -74.0060)
            weather_url = f"https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={OPENWEATHER_API_KEY}&units=imperial"
            import requests
            weather_resp = requests.get(weather_url, timeout=5)
            if weather_resp.status_code == 200:
                weather_data = weather_resp.json()
                temp = weather_data["main"]["temp"]
                desc = weather_data["weather"][0]["description"]
                weather_info = f"{int(temp)}°F, {desc}"
        except:
            pass
    
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.3*inch, bottomMargin=0.3*inch, leftMargin=0.4*inch, rightMargin=0.4*inch)
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('Title', parent=styles['Heading1'], fontSize=14, alignment=1, spaceAfter=5)
    subtitle_style = ParagraphStyle('Subtitle', parent=styles['Normal'], fontSize=9, alignment=1, textColor=colors.gray)
    section_style = ParagraphStyle('Section', parent=styles['Heading2'], fontSize=11, spaceBefore=10, spaceAfter=5, textColor=colors.HexColor('#003366'))
    
    elements = []
    
    # Header
    elements.append(Paragraph("NYC Buildings", title_style))
    elements.append(Paragraph("DAILY JOBSITE LOG", title_style))
    elements.append(Paragraph("Superintendent Required Jobsite Log 3301-02", subtitle_style))
    elements.append(Spacer(1, 0.15*inch))
    
    # Section 1: Project Information
    elements.append(Paragraph("1. Project Information", section_style))
    info_data = [
        ["Address:", project_address, "Date:", report_date],
        ["Weather:", weather_info, "", ""]
    ]
    info_table = Table(info_data, colWidths=[0.8*inch, 3*inch, 0.8*inch, 2.5*inch])
    info_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (2, 0), (2, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(info_table)
    
    # Section 3: Activity Details (Worker List)
    elements.append(Paragraph("3. Activity Details - Manpower Log", section_style))
    
    # Group by company
    companies = {}
    for c in checkins:
        company = get_legal_subcontractor_name(c.get("worker_company", "Unknown"), admin_id)
        if company not in companies:
            companies[company] = []
        companies[company].append(c)
    
    activity_data = [["Time In", "Worker Name", "Trade", "Legal Subcontractor", "OSHA #"]]
    for company, workers in companies.items():
        for w in workers:
            time_in = w.get("check_in_time")
            if isinstance(time_in, datetime):
                time_in = time_in.strftime("%H:%M")
            activity_data.append([
                time_in or "N/A",
                w.get("worker_name", "N/A"),
                w.get("worker_trade", "N/A"),
                company,
                w.get("worker_osha_number", "N/A")
            ])
    
    if len(activity_data) == 1:
        activity_data.append(["", "No check-ins recorded", "", "", ""])
    
    activity_table = Table(activity_data, colWidths=[0.7*inch, 1.8*inch, 1.2*inch, 1.8*inch, 1.2*inch])
    activity_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#003366')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.gray),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F5F5F5')]),
    ]))
    elements.append(activity_table)
    
    # Summary
    elements.append(Spacer(1, 0.1*inch))
    elements.append(Paragraph(f"<b>Total Workers:</b> {len(checkins)} | <b>Total Companies:</b> {len(companies)}", styles['Normal']))
    
    # Footer
    elements.append(Spacer(1, 0.3*inch))
    elements.append(Paragraph(f"Generated by Blueview | {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}", 
                             ParagraphStyle('Footer', fontSize=7, textColor=colors.gray, alignment=1)))
    
    doc.build(elements)
    return buffer.getvalue()

def generate_safety_meeting_pdf(project_id: str, meeting_date: str) -> bytes:
    """Generate Pre-Shift Safety Meeting PDF"""
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    
    meeting = safety_meetings_collection.find_one({
        "project_id": project_id,
        "meeting_date": meeting_date
    })
    
    project = projects_collection.find_one({"_id": ObjectId(project_id)})
    project_name = project["name"] if project else "Unknown"
    project_address = project.get("address", project.get("location", "")) if project else ""
    
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.4*inch, bottomMargin=0.4*inch)
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('Title', parent=styles['Heading1'], fontSize=14, alignment=1)
    section_style = ParagraphStyle('Section', parent=styles['Heading2'], fontSize=11, spaceBefore=10, spaceAfter=5)
    
    elements = []
    
    # Header
    elements.append(Paragraph("PRE-SHIFT SAFETY MEETING", title_style))
    elements.append(Spacer(1, 0.2*inch))
    
    # Meeting Info
    if meeting:
        info_data = [
            ["Company:", meeting.get("company", "N/A"), "Date:", meeting.get("meeting_date", meeting_date)],
            ["Time:", meeting.get("meeting_time", "N/A"), "DOB Permit #:", meeting.get("dob_permit_number", "N/A")],
            ["Job Location:", project_address, "Competent Person:", meeting.get("competent_person", "N/A")],
        ]
    else:
        info_data = [
            ["Company:", "N/A", "Date:", meeting_date],
            ["Job Location:", project_address, "", ""],
        ]
    
    info_table = Table(info_data, colWidths=[1.2*inch, 2.5*inch, 1.2*inch, 2.2*inch])
    info_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (2, 0), (2, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(info_table)
    
    # Daily Activities
    elements.append(Paragraph("Daily Work Activities To Be Performed During Shift:", section_style))
    elements.append(Paragraph(meeting.get("daily_activities", "N/A") if meeting else "N/A", styles['Normal']))
    
    # Safety Concerns
    elements.append(Paragraph("Safety Concerns or Risks:", section_style))
    elements.append(Paragraph(meeting.get("safety_concerns", "N/A") if meeting else "N/A", styles['Normal']))
    
    # Attendance
    elements.append(Paragraph("Attendance", section_style))
    
    attendance_data = [["#", "Name (Print)", "OSHA Num.", "Signature"]]
    if meeting and meeting.get("attendees"):
        for i, a in enumerate(meeting["attendees"], 1):
            attendance_data.append([
                str(i),
                a.get("worker_name", "N/A"),
                a.get("osha_number", "N/A"),
                "[Signed]" if a.get("signature") else ""
            ])
    else:
        # Use check-ins if no meeting record
        checkins = list(checkins_collection.find({
            "project_id": project_id,
            "date": meeting_date
        }))
        for i, c in enumerate(checkins, 1):
            attendance_data.append([
                str(i),
                c.get("worker_name", "N/A"),
                c.get("worker_osha_number", "N/A"),
                "[Signed]" if c.get("signature") else ""
            ])
    
    if len(attendance_data) == 1:
        attendance_data.append(["", "No attendees", "", ""])
    
    attendance_table = Table(attendance_data, colWidths=[0.5*inch, 2.5*inch, 2*inch, 2*inch])
    attendance_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#003366')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.gray),
        ('ALIGN', (0, 0), (0, -1), 'CENTER'),
    ]))
    elements.append(attendance_table)
    
    # Footer
    elements.append(Spacer(1, 0.3*inch))
    elements.append(Paragraph(f"Generated by Blueview | {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}", 
                             ParagraphStyle('Footer', fontSize=7, textColor=colors.gray, alignment=1)))
    
    doc.build(elements)
    return buffer.getvalue()

def generate_manpower_summary_pdf(project_id: str, report_date: str, admin_id: str) -> bytes:
    """Generate combined manpower summary PDF"""
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    
    project = projects_collection.find_one({"_id": ObjectId(project_id)})
    project_name = project["name"] if project else "Unknown"
    project_address = project.get("address", project.get("location", "")) if project else ""
    
    checkins = list(checkins_collection.find({
        "project_id": project_id,
        "date": report_date
    }))
    
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.4*inch, bottomMargin=0.4*inch)
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('Title', parent=styles['Heading1'], fontSize=18, alignment=1, textColor=colors.HexColor('#FF6B00'))
    subtitle_style = ParagraphStyle('Subtitle', parent=styles['Normal'], fontSize=12, alignment=1)
    section_style = ParagraphStyle('Section', parent=styles['Heading2'], fontSize=12, spaceBefore=15, spaceAfter=8, textColor=colors.HexColor('#003366'))
    
    elements = []
    
    # Header
    elements.append(Paragraph("BLUEVIEW", title_style))
    elements.append(Paragraph("Daily Manpower Report", subtitle_style))
    elements.append(Spacer(1, 0.2*inch))
    
    # Project Info Box
    info_data = [
        ["PROJECT:", project_name],
        ["ADDRESS:", project_address],
        ["DATE:", report_date],
        ["TOTAL MANPOWER:", f"{len(checkins)} Workers"],
    ]
    info_table = Table(info_data, colWidths=[1.5*inch, 5.5*inch])
    info_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#003366')),
        ('TEXTCOLOR', (0, 0), (0, -1), colors.white),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('PADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#CCCCCC')),
    ]))
    elements.append(info_table)
    
    # Manpower by Company
    elements.append(Paragraph("Manpower by Subcontractor", section_style))
    
    companies = {}
    for c in checkins:
        company = get_legal_subcontractor_name(c.get("worker_company", "Unknown"), admin_id)
        if company not in companies:
            companies[company] = {"count": 0, "workers": []}
        companies[company]["count"] += 1
        companies[company]["workers"].append(c)
    
    summary_data = [["Legal Subcontractor Name", "Trade", "# Workers"]]
    for company, data in companies.items():
        trades = set(w.get("worker_trade", "N/A") for w in data["workers"])
        summary_data.append([company, ", ".join(trades), str(data["count"])])
    
    if len(summary_data) == 1:
        summary_data.append(["No workers checked in", "", "0"])
    
    summary_table = Table(summary_data, colWidths=[3*inch, 2.5*inch, 1.5*inch])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#FF6B00')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.gray),
        ('ALIGN', (-1, 0), (-1, -1), 'CENTER'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#FFF5EB')]),
    ]))
    elements.append(summary_table)
    
    # Detailed Worker List
    elements.append(Paragraph("Worker Sign-In Ledger", section_style))
    
    worker_data = [["#", "Time In", "Worker Name", "Trade", "Company", "OSHA #"]]
    for i, c in enumerate(checkins, 1):
        time_in = c.get("check_in_time")
        if isinstance(time_in, datetime):
            time_in = time_in.strftime("%H:%M")
        worker_data.append([
            str(i),
            time_in or "N/A",
            c.get("worker_name", "N/A"),
            c.get("worker_trade", "N/A"),
            get_legal_subcontractor_name(c.get("worker_company", "N/A"), admin_id),
            c.get("worker_osha_number", "N/A")
        ])
    
    if len(worker_data) == 1:
        worker_data.append(["", "", "No check-ins", "", "", ""])
    
    worker_table = Table(worker_data, colWidths=[0.4*inch, 0.7*inch, 1.5*inch, 1.2*inch, 1.5*inch, 1*inch])
    worker_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#003366')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.gray),
        ('ALIGN', (0, 0), (1, -1), 'CENTER'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F5F5F5')]),
    ]))
    elements.append(worker_table)
    
    # Footer
    elements.append(Spacer(1, 0.4*inch))
    elements.append(Paragraph(f"Report Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')} | Blueview Construction Management", 
                             ParagraphStyle('Footer', fontSize=8, textColor=colors.gray, alignment=1)))
    
    doc.build(elements)
    return buffer.getvalue()

# ============== REPORT GENERATION & DISTRIBUTION ==============

@app.post("/api/projects/{project_id}/generate-daily-report")
async def generate_daily_report(
    project_id: str, 
    report_date: Optional[str] = None,
    background_tasks: BackgroundTasks = None,
    current_user: dict = Depends(require_admin)
):
    """Manually trigger daily report generation and email distribution"""
    if not report_date:
        report_date = date.today().isoformat()
    
    # Get report settings
    settings = report_settings_collection.find_one({"project_id": project_id})
    
    # Get project
    project = projects_collection.find_one({"_id": ObjectId(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Get check-ins count
    checkins_count = checkins_collection.count_documents({
        "project_id": project_id,
        "date": report_date
    })
    
    # Generate PDFs
    reports = {}
    
    # Generate Jobsite Log
    try:
        jobsite_pdf = generate_jobsite_log_pdf(project_id, report_date, current_user["id"])
        reports["jobsite_log"] = base64.b64encode(jobsite_pdf).decode()
    except Exception as e:
        reports["jobsite_log_error"] = str(e)
    
    # Generate Safety Meeting PDF
    try:
        safety_pdf = generate_safety_meeting_pdf(project_id, report_date)
        reports["safety_meeting"] = base64.b64encode(safety_pdf).decode()
    except Exception as e:
        reports["safety_meeting_error"] = str(e)
    
    # Generate Manpower Summary
    try:
        manpower_pdf = generate_manpower_summary_pdf(project_id, report_date, current_user["id"])
        reports["manpower_summary"] = base64.b64encode(manpower_pdf).decode()
    except Exception as e:
        reports["manpower_summary_error"] = str(e)
    
    # Store report record
    report_record = {
        "project_id": project_id,
        "project_name": project["name"],
        "report_date": report_date,
        "generated_at": datetime.utcnow(),
        "generated_by": current_user["id"],
        "workers_count": checkins_count,
        "reports": reports,
        "email_sent": False,
        "email_recipients": []
    }
    
    result = generated_reports_collection.insert_one(report_record)
    report_id = str(result.inserted_id)
    
    # Send email if recipients configured
    email_sent = False
    email_error = None
    if settings and settings.get("email_recipients") and RESEND_API_KEY:
        try:
            recipients = settings["email_recipients"]
            
            # Create email with attachment
            email_body = f"""
            <h2>Daily Manpower Report - {project["name"]}</h2>
            <p><strong>Date:</strong> {report_date}</p>
            <p><strong>Total Workers:</strong> {checkins_count}</p>
            <p>Please find the attached daily reports.</p>
            <hr>
            <p><em>Generated by Blueview Construction Management</em></p>
            """
            
            # Prepare attachments
            attachments = []
            if "manpower_summary" in reports:
                attachments.append({
                    "filename": f"ManpowerReport_{report_date}.pdf",
                    "content": reports["manpower_summary"]
                })
            if "jobsite_log" in reports:
                attachments.append({
                    "filename": f"JobsiteLog_{report_date}.pdf",
                    "content": reports["jobsite_log"]
                })
            if "safety_meeting" in reports:
                attachments.append({
                    "filename": f"SafetyMeeting_{report_date}.pdf",
                    "content": reports["safety_meeting"]
                })
            
            resend.api_key = RESEND_API_KEY
            email_result = resend.Emails.send({
                "from": "Blueview Reports <reports@resend.dev>",
                "to": recipients,
                "subject": f"Daily Manpower Report - {project['name']} - {report_date}",
                "html": email_body,
                "attachments": attachments
            })
            
            email_sent = True
            generated_reports_collection.update_one(
                {"_id": ObjectId(report_id)},
                {"$set": {
                    "email_sent": True,
                    "email_recipients": recipients,
                    "email_sent_at": datetime.utcnow()
                }}
            )
            
        except Exception as e:
            email_error = str(e)
    
    return {
        "report_id": report_id,
        "project_name": project["name"],
        "report_date": report_date,
        "workers_count": checkins_count,
        "reports_generated": list(k for k in reports.keys() if not k.endswith("_error")),
        "email_sent": email_sent,
        "email_recipients": settings.get("email_recipients", []) if settings else [],
        "email_error": email_error
    }

@app.get("/api/projects/{project_id}/reports")
def get_project_reports(project_id: str, current_user: dict = Depends(require_admin)):
    """Get all generated reports for a project (for audit/download)"""
    reports = list(generated_reports_collection.find({"project_id": project_id}).sort("report_date", -1).limit(30))
    
    # Remove large PDF data for listing
    result = []
    for r in reports:
        result.append({
            "id": str(r["_id"]),
            "project_id": r["project_id"],
            "report_date": r["report_date"],
            "generated_at": r["generated_at"],
            "workers_count": r.get("workers_count", 0),
            "email_sent": r.get("email_sent", False),
            "email_recipients": r.get("email_recipients", [])
        })
    
    return result

@app.get("/api/reports/{report_id}/download")
def download_report(report_id: str, report_type: str = "manpower_summary", current_user: dict = Depends(get_current_user)):
    """Download a specific report PDF"""
    report = generated_reports_collection.find_one({"_id": ObjectId(report_id)})
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    pdf_data = report.get("reports", {}).get(report_type)
    if not pdf_data:
        raise HTTPException(status_code=404, detail=f"Report type '{report_type}' not found")
    
    return {
        "pdf_base64": pdf_data,
        "filename": f"{report_type}_{report['report_date']}.pdf",
        "report_date": report["report_date"]
    }

@app.get("/api/checkins/{project_id}/{checkin_date}")
def get_project_checkins(project_id: str, checkin_date: str, current_user: dict = Depends(get_current_user)):
    """Get all check-ins for a project on a specific date"""
    checkins = list(checkins_collection.find({
        "project_id": project_id,
        "date": checkin_date
    }))
    return serialize_docs(checkins)

@app.post("/api/setup/init-admin")
def init_admin():
    """Initialize the first admin account"""
    existing_admin = users_collection.find_one({"role": "admin"})
    if existing_admin:
        # Return existing admin info (without password)
        return {
            "message": "Admin already exists",
            "email": existing_admin["email"],
            "note": "Use existing credentials to login"
        }
    
    admin_dict = {
        "email": "admin@blueview.com",
        "password": hash_password("BlueviewAdmin123"),
        "name": "Site Admin",
        "role": "admin",
        "assigned_projects": [],
        "created_at": datetime.utcnow(),
    }
    result = users_collection.insert_one(admin_dict)
    
    return {
        "message": "Admin created successfully",
        "credentials": {
            "email": "admin@blueview.com",
            "password": "BlueviewAdmin123"
        },
        "note": "Please save these credentials securely!"
    }

@app.get("/api/setup/status")
def get_setup_status():
    """Check setup status - for testing purposes"""
    admin_exists = users_collection.find_one({"role": "admin"}) is not None
    project_count = projects_collection.count_documents({})
    worker_count = workers_collection.count_documents({})
    subcontractor_count = users_collection.count_documents({"role": "subcontractor"})
    material_request_count = material_requests_collection.count_documents({})
    
    return {
        "admin_exists": admin_exists,
        "project_count": project_count,
        "worker_count": worker_count,
        "subcontractor_count": subcontractor_count,
        "material_request_count": material_request_count,
        "database": "MongoDB Atlas",
        "roles": ["admin", "subcontractor", "worker"],
        "integrations": {
            "google_oauth": bool(GOOGLE_CLIENT_ID),
            "openweather": bool(OPENWEATHER_API_KEY),
            "resend_email": bool(RESEND_API_KEY),
            "dropbox": bool(DROPBOX_APP_KEY and DROPBOX_APP_SECRET),
            "twilio_sms": bool(TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN),
            "radar_geofence": bool(RADAR_API_KEY)
        },
        "features": {
            "rbac": True,
            "material_requests": True,
            "geofencing": "ready (credentials pending)" if not RADAR_API_KEY else "active",
            "sms_checkin": "ready (credentials pending)" if not TWILIO_ACCOUNT_SID else "active",
            "dob_daily_log": True,
            "dropbox_impersonation": True
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
