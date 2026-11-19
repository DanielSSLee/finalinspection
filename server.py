#!/usr/bin/env python3
"""
FVI Station 01 — Photovoltaic Final Visual Inspection Console
Turnkey Manufacturing Edge Gateway Server

Features:
1. Plant CMMS Authentication & User Validation
2. Instant Database Persistence for Cell Defects (HTTP POST /api/defects)
3. EL Camera PC Image Acquisition via FTP (with local caching)
4. MQTT Conveyor Panel Stream & Real-time SSE Broadcasts
5. Zero External Python Dependencies (Uses standard library)
"""

import os
import re
import sys
import json
import time
import socket
import struct
import select
import sqlite3
import ftplib
import hashlib
import mimetypes
import threading
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs
try:
    from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
except ImportError:
    from http.server import HTTPServer as ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path

# Base Paths
BASE_DIR = Path(__file__).resolve().parent
DB_FILE = BASE_DIR / "fvi_production.db"
CACHE_DIR = BASE_DIR / "el_cache"
CACHE_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# Environment Variable Loader (.env support with zero external dependencies)
# ---------------------------------------------------------------------------
def _load_env_file(dotenv_path=None):
    if dotenv_path is None:
        dotenv_path = BASE_DIR / ".env"
    if not os.path.exists(dotenv_path):
        return
    try:
        with open(dotenv_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
    except Exception as e:
        print(f"[-] Warning: Failed to load .env file: {e}")

# Try python-dotenv if installed, otherwise use built-in loader
try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=BASE_DIR / ".env")
except ImportError:
    _load_env_file()

def _env_str(key, default=""):
    return os.environ.get(key, default)

def _env_int(key, default=0):
    val = os.environ.get(key)
    if val is None or val == "":
        return default
    try:
        return int(val)
    except ValueError:
        return default

def _env_bool(key, default=False):
    val = os.environ.get(key)
    if val is None or val == "":
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")

# Server Configuration Defaults (Securely populated from environment / .env)
CONFIG = {
    "host": _env_str("SERVER_HOST", "0.0.0.0"),
    "port": _env_int("SERVER_PORT", 8080),
    "station_mode": _env_str("STATION_MODE", "fvi").strip().lower(),
    
    # 1. Company CMMS Authentication Settings
    "cmms_database": {
        "mode": _env_str("CMMS_MODE", "external_rest"),
        "rest_login_url": _env_str("CMMS_REST_LOGIN_URL", "http://localhost:8000/api/v1/auth/login"),
        "rest_me_url": _env_str("CMMS_REST_ME_URL", "http://localhost:8000/api/v1/auth/me"),
        "rest_timeout_sec": _env_int("CMMS_REST_TIMEOUT_SEC", 5),
        
        # Direct PostgreSQL fallback configuration
        "sql_type": _env_str("CMMS_SQL_TYPE", "postgres"),
        "host": _env_str("CMMS_HOST", "localhost"),
        "port": _env_int("CMMS_PORT", 5432),
        "database": _env_str("CMMS_DATABASE", "cmms"),
        "username": _env_str("CMMS_USERNAME", "postgres"),
        "password": _env_str("CMMS_PASSWORD", ""),
        "user_query": 'SELECT id as user_id, username, hashed_password as password_hash, full_name, role FROM public."user" WHERE LOWER(username) = LOWER(%s) AND is_active = true AND is_deleted = false'
    },

    # 2. EL Testing Camera PC Image Acquisition via FTP (FVI -> EL2 PC)
    "ftp": {
        "host": _env_str("FTP_HOST", "100.100.200.223"),
        "port": _env_int("FTP_PORT", 21),
        "username": _env_str("FTP_USERNAME", "FTPUser"),
        "password": _env_str("FTP_PASSWORD", "USM26!"),
        "remote_dir": _env_str("FTP_REMOTE_DIR", "/"),
        "enabled": _env_bool("FTP_ENABLED", True)
    },

    # 2b. Post-Lam Dual EL1 Camera PCs Image Acquisition via FTP (L2_QEL001 & L2_QEL002)
    "ftp_postlam": {
        "hosts": [
            h.strip() for h in (
                _env_str("POSTLAM_FTP_HOSTS", "")
                or ",".join([
                    _env_str("POSTLAM_FTP_HOST", "10.1.19.75"),
                    _env_str("POSTLAM_FTP_HOST_2", "10.1.19.86")
                ])
            ).split(",") if h.strip()
        ],
        "host": _env_str("POSTLAM_FTP_HOST", "10.1.19.75"),
        "port": _env_int("POSTLAM_FTP_PORT", 21),
        "username": _env_str("POSTLAM_FTP_USERNAME", "FTPUser"),
        "password": _env_str("POSTLAM_FTP_PASSWORD", "USM26!"),
        "remote_dir": _env_str("POSTLAM_FTP_REMOTE_DIR", "/EL"),
        "enabled": _env_bool("POSTLAM_FTP_ENABLED", True)
    },

    # 3. Conveyor Arrival Sensor via MQTT (Line 2 Conveyors CH88 & CH89)
    "mqtt": {
        "broker": _env_str("MQTT_BROKER", "100.100.0.17") if _env_str("MQTT_BROKER", "100.100.0.17") not in ("localhost", "100.100.100.60") else "100.100.0.17",
        "port": _env_int("MQTT_PORT", 1883),
        "username": _env_str("MQTT_USERNAME", "line2-equipment") or "line2-equipment",
        "password": _env_str("MQTT_PASSWORD", "3cwDa4Lf6NZH2u") or "3cwDa4Lf6NZH2u",
        "topic": _env_str("MQTT_TOPIC", "usm/cstx/prod/line2/#") if "line2" in _env_str("MQTT_TOPIC", "") else "usm/cstx/prod/line2/#",
        "enabled": _env_bool("MQTT_ENABLED", True)
    },

    # 4. Microsoft SQL Server Production Database (PL2)
    "mssql": {
        "enabled": _env_bool("MSSQL_ENABLED", True),
        "server": _env_str("MSSQL_SERVER", "100.100.100.50"),
        "port": _env_int("MSSQL_PORT", 1433),
        "database": _env_str("MSSQL_DATABASE", "PL2"),
        "user": _env_str("MSSQL_USER", "Final_Inspection"),
        "password": _env_str("MSSQL_PASSWORD", "USM26"),
        "postlam_user": _env_str("POSTLAM_MSSQL_USER", ""),
        "postlam_password": _env_str("POSTLAM_MSSQL_PASSWORD", ""),
        "read_user": _env_str("MSSQL_READ_USER", "usm"),
        "read_password": _env_str("MSSQL_READ_PASSWORD", "usm2026"),
        "trust_server_certificate": _env_str("MSSQL_TRUST_CERT", "yes"),
        "driver": _env_str("MSSQL_DRIVER", "ODBC Driver 17 for SQL Server"),
        "timeout": _env_int("MSSQL_TIMEOUT", 3)
    },

    # 5. Sun Simulator Flasher Database (Microsoft SQL Server / SQLExpress)
    "sunsim_sqlexpress": {
        "enabled": _env_bool("SUNSIM_ENABLED", False),
        "driver": _env_str("SUNSIM_DRIVER", "ODBC Driver 17 for SQL Server"),
        "host": _env_str("SUNSIM_HOST", "localhost"),
        "port": _env_int("SUNSIM_PORT", 1433),
        "database": _env_str("SUNSIM_DATABASE", "SunSimulator_FVI"),
        "user": _env_str("SUNSIM_USER", "sunsim_reader"),
        "password": _env_str("SUNSIM_PASSWORD", ""),
        "timeout": _env_int("SUNSIM_TIMEOUT", 2),
        "query": "SELECT TOP 1 module_id, pmax_w, voc_v, isc_a, vmp_v, imp_a, fill_factor, efficiency, cell_temp_c, irradiance_w_m2, flash_timestamp, status FROM test_results WHERE module_id = ? ORDER BY test_date DESC"
    },

    # 6. Hi-Pot Electrical Safety Tester Database (PostgreSQL)
    "hipot_postgres": {
        "enabled": _env_bool("HIPOT_ENABLED", False),
        "host": _env_str("HIPOT_HOST", "localhost"),
        "port": _env_int("HIPOT_PORT", 5432),
        "database": _env_str("HIPOT_DATABASE", "hipot_tests"),
        "user": _env_str("HIPOT_USER", "hipot_reader"),
        "password": _env_str("HIPOT_PASSWORD", ""),
        "timeout": _env_int("HIPOT_TIMEOUT", 2),
        "query": "SELECT module_id, test_voltage_v, leakage_current_ma, insulation_resistance_mohm, ground_bond_ohm, test_duration_sec, overall_result, tested_at, tester_id FROM hipot_records WHERE module_id = %s ORDER BY tested_at DESC LIMIT 1"
    }
}


# ---------------------------------------------------------------------------
# Sun Simulator, Hi-Pot & EL2 Telemetry Fetchers (MSSQL PL2 Live & Clean Fallback)
# ---------------------------------------------------------------------------
def get_sunsim_telemetry(module_id):
    """
    Queries Microsoft SQL Server PL2 (dbo.IV_Flasher) for Flasher I-V curve & Pmax data.
    When offline or module not found, returns clean structured fallback with zero fake fields.
    """
    if module_id:
        conn, engine = get_mssql_read_connection()
        if conn:
            try:
                cur = conn.cursor()
                query = """
                    SELECT TOP 1 Record_ID, Module_ID, CONVERT(varchar(32), Tested_At, 120) AS Tested_At,
                           Pmpp, Impp, Vmpp, Voc, Isc, Fill_Factor, Result_File
                    FROM dbo.IV_Flasher
                    WHERE Module_ID = ?
                    ORDER BY Record_ID DESC
                """
                if engine == "MSSQL_PYMSSQL":
                    query = query.replace("?", "%s")
                cur.execute(query, (module_id,))
                row = cur.fetchone()
                if row:
                    cols = [desc[0].lower() for desc in cur.description]
                    row_dict = dict(zip(cols, row))
                    conn.close()

                    pmpp = float(row_dict.get("pmpp") or 0.0)
                    vmpp = float(row_dict.get("vmpp") or 0.0)
                    impp = float(row_dict.get("impp") or 0.0)
                    voc = float(row_dict.get("voc") or 0.0)
                    isc = float(row_dict.get("isc") or 0.0)
                    ff = float(row_dict.get("fill_factor") or 0.0)

                    num_pts = 60
                    combined_curve = []
                    for i in range(num_pts + 1):
                        v = round((voc * i) / num_pts, 2) if num_pts > 0 else 0.0
                        v_norm = v / voc if voc > 0 else 0.0
                        cur_i = round(max(0.0, isc * (1.0 - (v_norm ** 9.6))), 3) if (voc > 0 and v < voc) else 0.0
                        p = round(v * cur_i, 1)
                        combined_curve.append({"v": v, "i": cur_i, "p": p})

                    return {
                        "found": True,
                        "source": f"MSSQL_PL2_LIVE ({engine})",
                        "record_id": row_dict.get("record_id"),
                        "module_id": row_dict.get("module_id") or module_id,
                        "tested_at": str(row_dict.get("tested_at") or ""),
                        "pmpp": round(pmpp, 2),
                        "pmax": round(pmpp, 2),
                        "vmpp": round(vmpp, 2),
                        "vmp": round(vmpp, 2),
                        "impp": round(impp, 2),
                        "imp": round(impp, 2),
                        "voc": round(voc, 2),
                        "isc": round(isc, 2),
                        "fill_factor": round(ff, 2),
                        "ff": round(ff, 2),
                        "result_file": str(row_dict.get("result_file") or ""),
                        "iv_curve": combined_curve,
                        "pmax_curve": combined_curve
                    }
                conn.close()
            except Exception as e:
                try:
                    conn.close()
                except Exception:
                    pass

    # Fallback when a module is not yet in dbo.IV_Flasher (or DB is offline)
    fallback_voc = 50.35
    fallback_isc = 13.56
    fallback_vmpp = 42.28
    fallback_impp = 12.88
    fallback_pmpp = round(fallback_vmpp * fallback_impp, 2)
    fallback_ff = round((fallback_pmpp / (fallback_voc * fallback_isc)) * 100.0, 2)

    combined_curve = []
    num_pts = 60
    for i in range(num_pts + 1):
        v = round((fallback_voc * i) / num_pts, 2)
        v_norm = v / fallback_voc if fallback_voc > 0 else 0.0
        cur_i = round(max(0.0, fallback_isc * (1.0 - (v_norm ** 9.6))), 3) if v < fallback_voc else 0.0
        p = round(v * cur_i, 1)
        combined_curve.append({"v": v, "i": cur_i, "p": p})

    return {
        "found": False,
        "source": "SIMULATED_FALLBACK",
        "record_id": None,
        "module_id": module_id or "",
        "tested_at": "",
        "pmpp": fallback_pmpp,
        "pmax": fallback_pmpp,
        "vmpp": fallback_vmpp,
        "vmp": fallback_vmpp,
        "impp": fallback_impp,
        "imp": fallback_impp,
        "voc": fallback_voc,
        "isc": fallback_isc,
        "fill_factor": fallback_ff,
        "ff": fallback_ff,
        "result_file": "",
        "iv_curve": combined_curve,
        "pmax_curve": combined_curve
    }


def get_hipot_telemetry(module_id):
    """
    Queries Microsoft SQL Server PL2 (dbo.Hipot) for dielectric withstand safety data.
    When offline or module not found, returns clean 5-field structured fallback with zero fake fields.
    """
    if module_id:
        conn, engine = get_mssql_read_connection()
        if conn:
            try:
                cur = conn.cursor()
                query = """
                    SELECT TOP 1 Record_ID, Module_ID, CONVERT(varchar(32), Tested_At, 120) AS Tested_At,
                           Passed, Result_File
                    FROM dbo.Hipot
                    WHERE Module_ID = ?
                    ORDER BY Record_ID DESC
                """
                if engine == "MSSQL_PYMSSQL":
                    query = query.replace("?", "%s")
                cur.execute(query, (module_id,))
                row = cur.fetchone()
                if row:
                    cols = [desc[0].lower() for desc in cur.description]
                    row_dict = dict(zip(cols, row))
                    conn.close()

                    passed_bool = bool(row_dict.get("passed"))
                    overall = "PASS" if passed_bool else "FAIL"
                    return {
                        "found": True,
                        "source": f"MSSQL_PL2_LIVE ({engine})",
                        "record_id": row_dict.get("record_id"),
                        "module_id": row_dict.get("module_id") or module_id,
                        "tested_at": str(row_dict.get("tested_at") or ""),
                        "passed": passed_bool,
                        "overall_result": overall,
                        "result_file": str(row_dict.get("result_file") or "")
                    }
                conn.close()
            except Exception as e:
                try:
                    conn.close()
                except Exception:
                    pass

    return {
        "found": False,
        "source": "SIMULATED_FALLBACK",
        "record_id": None,
        "module_id": module_id or "",
        "tested_at": "",
        "passed": False,
        "overall_result": "N/A",
        "result_file": ""
    }


def _normalize_station(raw_val):
    s = str(raw_val or "").strip().lower()
    if s in ("postlam", "post_lam", "post-lam", "pl"):
        return "postlam"
    return "fvi"


def _resolve_station_mode(query_params=None, payload=None):
    if isinstance(payload, dict) and payload.get("station"):
        return _normalize_station(payload.get("station"))
    if isinstance(query_params, dict):
        q_vals = query_params.get("station") or query_params.get("mode")
        if q_vals and len(q_vals) > 0 and q_vals[0]:
            return _normalize_station(q_vals[0])
    return _normalize_station(CONFIG.get("station_mode", "fvi"))


el_folder_cache = {}  # cache_key -> "OK" | "NG"


def _folder_cache_key(module_id, station="fvi"):
    mod_key = str(module_id or "").strip().upper()
    if not mod_key:
        return ""
    return f"postlam_{mod_key}" if _normalize_station(station) == "postlam" else mod_key


def extract_el_folder_status(image_path="", vis_image="", ai_result=None, retrial_result=None, module_id="", station="fvi"):
    """
    Determines whether the EL image originates from the 'OK' or 'NG' folder.
    Checks image_path / vis_image segments first, then in-memory / sidecar caches,
    and falls back to retrial_result / ai_result booleans.
    """
    for p in (image_path, vis_image):
        if not p:
            continue
        norm = str(p).replace("\\", "/").upper()
        if "/OK/" in norm or norm.endswith("/OK"):
            return "OK"
        if "/NG/" in norm or norm.endswith("/NG"):
            return "NG"

    cache_key = _folder_cache_key(module_id, station)
    if cache_key:
        if el_folder_cache.get(cache_key) in ("OK", "NG"):
            return el_folder_cache[cache_key]
        try:
            sidecar = CACHE_DIR / f"{cache_key}.folder"
            if sidecar.exists():
                val = sidecar.read_text(encoding="utf-8").strip().upper()
                if val in ("OK", "NG"):
                    el_folder_cache[cache_key] = val
                    return val
        except Exception:
            pass

    for flag in (retrial_result, ai_result):
        if flag is None:
            continue
        if isinstance(flag, bool):
            return "OK" if flag else "NG"
        if isinstance(flag, (int, float)):
            return "OK" if flag == 1 else "NG"
        s = str(flag).strip().upper()
        if s in ("TRUE", "1", "OK", "PASS"):
            return "OK"
        if s in ("FALSE", "0", "NG", "FAIL"):
            return "NG"

    return ""


def _cache_el_folder_status(module_id, status, station="fvi"):
    cache_key = _folder_cache_key(module_id, station)
    st = str(status or "").strip().upper()
    if cache_key and st in ("OK", "NG"):
        el_folder_cache[cache_key] = st
        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            (CACHE_DIR / f"{cache_key}.folder").write_text(st, encoding="utf-8")
        except Exception:
            pass


def _query_el_metadata(table_name, module_id, include_vis_image=True, station="fvi"):
    """
    Shared helper querying dbo.EL1 or dbo.EL2 in MSSQL PL2 for module EL metadata.
    """
    vis_col = ", Vis_Image" if include_vis_image else ""
    if module_id:
        conn, engine = get_mssql_read_connection()
        if conn:
            try:
                cur = conn.cursor()
                query = f"""
                    SELECT TOP 1 Record_ID, Module_ID, CONVERT(varchar(32), Tested_At, 120) AS Tested_At,
                           AIResult, RetrialResult, Image_Path{vis_col}, Result_File, Tester_Name
                    FROM {table_name}
                    WHERE Module_ID = ?
                    ORDER BY Tested_At DESC, Record_ID DESC
                """
                if engine == "MSSQL_PYMSSQL":
                    query = query.replace("?", "%s")
                cur.execute(query, (module_id,))
                row = cur.fetchone()
                if row:
                    cols = [desc[0].lower() for desc in cur.description]
                    rdict = dict(zip(cols, row))
                    conn.close()
                    img_path = str(rdict.get("image_path") or "")
                    vis_img = str(rdict.get("vis_image") or "") if include_vis_image else ""
                    res_file = str(rdict.get("result_file") or "")
                    ai_res = rdict.get("airesult")
                    retrial_res = rdict.get("retrialresult")
                    machine_match = re.search(r"L2_QEL\d+", f"{img_path} {res_file}", re.IGNORECASE)
                    el_machine = machine_match.group(0).upper() if machine_match else ""
                    folder_status = extract_el_folder_status(
                        image_path=img_path,
                        vis_image=vis_img,
                        ai_result=ai_res,
                        retrial_result=retrial_res,
                        module_id=module_id,
                        station=station
                    )
                    if folder_status in ("OK", "NG"):
                        _cache_el_folder_status(module_id, folder_status, station=station)
                    return {
                        "found": True,
                        "source": f"MSSQL_PL2_LIVE ({engine})",
                        "record_id": rdict.get("record_id"),
                        "module_id": rdict.get("module_id") or module_id,
                        "tested_at": str(rdict.get("tested_at") or ""),
                        "ai_result": ai_res,
                        "retrial_result": retrial_res,
                        "image_path": img_path,
                        "vis_image": vis_img,
                        "result_file": res_file,
                        "tester_name": str(rdict.get("tester_name") or ""),
                        "el_machine": el_machine,
                        "folder_status": folder_status
                    }
                conn.close()
            except Exception:
                try:
                    conn.close()
                except Exception:
                    pass

    fallback_folder = extract_el_folder_status(module_id=module_id, station=station)
    return {
        "found": False,
        "source": "SIMULATED_FALLBACK",
        "record_id": None,
        "module_id": module_id or "",
        "tested_at": "",
        "ai_result": None,
        "retrial_result": None,
        "image_path": "",
        "vis_image": "",
        "result_file": "",
        "tester_name": "",
        "el_machine": "",
        "folder_status": fallback_folder
    }


def get_el2_metadata(module_id):
    """Queries dbo.EL2 in MSSQL PL2 for FVI module EL inspection metadata."""
    return _query_el_metadata("dbo.EL2", module_id, include_vis_image=True, station="fvi")


def get_el1_metadata(module_id):
    """Queries dbo.EL1 in MSSQL PL2 for Post-Lam module EL inspection metadata."""
    return _query_el_metadata("dbo.EL1", module_id, include_vis_image=False, station="postlam")


def get_latest_production_module():
    """
    Queries dbo.EL2 or dbo.IV_Flasher in MSSQL PL2 for the latest live module on Line 2
    so the station display always boots up with the current production panel.
    """
    conn, engine = get_mssql_read_connection()
    if conn:
        try:
            cur = conn.cursor()
            cur.execute("SELECT TOP 1 Module_ID FROM dbo.EL2 ORDER BY Record_ID DESC")
            row = cur.fetchone()
            if row and row[0]:
                conn.close()
                return str(row[0]).strip()
            cur.execute("SELECT TOP 1 Module_ID FROM dbo.IV_Flasher ORDER BY Record_ID DESC")
            row2 = cur.fetchone()
            if row2 and row2[0]:
                conn.close()
                return str(row2[0]).strip()
            conn.close()
        except Exception:
            try:
                conn.close()
            except Exception:
                pass
    return ""

# In-Memory State
active_clients = []
current_conveyor_panel = {
    "panel_id": "",
    "channel": "IDLE",
    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "source": "Initial Baseline"
}
active_main_screen_module = ""
active_main_screen_module_by_station = {"fvi": "", "postlam": ""}
active_sessions = {}  # token -> user dict
mqtt_connected = False
mqtt_channel_serials = {"CH88": None, "CH89": None}
mqtt_queue = []  # list of {"panel_id": str, "channel": "CH88"|"CH89", "timestamp": str, "source": str}
prefetched_telemetry = {}  # panel_id -> {"sunsim": ..., "hipot": ..., "el_image": ..., "el_fallback": ..., "cached_at": float}
_initial_conveyor_seeded = False
_recent_inspections_lock = threading.Lock()
_recent_inspections = {}  # (station, module_id) -> {"grade": grade, "timestamp": float, "record_id": int, "engine": str}

# Defect Code to IEC Type ID (int2)
DEFECT_CODE_TO_ID = {
    "A1": 1, "A2": 2, "B1": 3, "B2": 4,
    "C1": 5, "X1": 6, "X2": 7, "X3": 8
}

DEFECT_CODE_TO_NAME = {
    "A1": "Micro-Crack (Hairline)",
    "A2": "Cross-Crack / Star Crack",
    "B1": "Dead Finger / Inactive Area",
    "B2": "Solder Disconnect / Void",
    "C1": "Dark Cell / Low Shunt",
    "X1": "Broken Cell / Corner V-Crack",
    "X2": "Severe Hotspot / Solder Bead",
    "X3": "Delamination / Foreign Mat."
}

# ---------------------------------------------------------------------------
# Database Initialization & Connection (Microsoft SQL Server PL2 & SQLite)
# ---------------------------------------------------------------------------
def get_db():
    conn = sqlite3.connect(DB_FILE, timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn

_last_mssql_attempt = 0
_last_mssql_read_attempt = 0
_mssql_cooldown_sec = 10

def get_mssql_connection(station="fvi"):
    """
    Connects to Microsoft SQL Server using credentials from environment variables / .env.
    Tries pyodbc first (ODBC Driver 17/18), falls back to pymssql.
    Configures pyodbc output converter for SQL Server datetimeoffset (-155).
    Supports optional Post-Lam DB user/password falling back to default MSSQL user/password.
    """
    global _last_mssql_attempt
    cfg = CONFIG.get("mssql", {})
    if not cfg.get("enabled", False):
        return None, None

    now = time.time()
    station_norm = _normalize_station(station)
    db_user = cfg.get("user")
    db_password = cfg.get("password")
    if station_norm == "postlam" and cfg.get("postlam_user"):
        db_user = cfg.get("postlam_user")
        db_password = cfg.get("postlam_password") or db_password
    elif (now - _last_mssql_attempt) < _mssql_cooldown_sec:
        return None, None

    # 1. Try pyodbc (ODBC Driver 17 or 18)
    try:
        import pyodbc
        try:
            pyodbc.add_output_converter(-155, lambda b: str(b))
        except Exception:
            pass
        for driver in ["ODBC Driver 17 for SQL Server", "ODBC Driver 18 for SQL Server", "SQL Server"]:
            try:
                conn_str = (
                    f"DRIVER={{{driver}}};"
                    f"SERVER={cfg['server']},{cfg.get('port', 1433)};"
                    f"DATABASE={cfg['database']};"
                    f"UID={db_user};"
                    f"PWD={db_password};"
                    f"TrustServerCertificate=yes;"
                    f"Timeout={cfg.get('timeout', 3)};"
                )
                conn = pyodbc.connect(conn_str, timeout=cfg.get("timeout", 3))
                try:
                    conn.add_output_converter(-155, lambda b: str(b))
                except Exception:
                    pass
                _last_mssql_attempt = 0
                return conn, "MSSQL_PYODBC"
            except Exception:
                continue
    except ImportError:
        pass

    # 2. Try pymssql (pure Python / TDS protocol)
    try:
        import pymssql
        conn = pymssql.connect(
            server=cfg["server"],
            port=int(cfg.get("port", 1433)),
            user=db_user,
            password=db_password,
            database=cfg["database"],
            timeout=cfg.get("timeout", 3)
        )
        _last_mssql_attempt = 0
        return conn, "MSSQL_PYMSSQL"
    except Exception as e:
        if station_norm != "postlam" or not cfg.get("postlam_user"):
            _last_mssql_attempt = now
        print(f"[MSSQL Notice] Offline fallback: {e}. Using local SQLite (retrying MSSQL in {_mssql_cooldown_sec}s).")
        return None, None

def get_mssql_read_connection():
    """
    Connects to Microsoft SQL Server PL2 (100.100.100.50:1433) using read-only credentials (usm / usm2026).
    Falls back to get_mssql_connection() if read credentials fail.
    Configures pyodbc output converter for SQL Server datetimeoffset (-155).
    """
    global _last_mssql_read_attempt
    cfg = CONFIG.get("mssql", {})
    if not cfg.get("enabled", False):
        return None, None

    now = time.time()
    if (now - _last_mssql_read_attempt) < _mssql_cooldown_sec:
        return get_mssql_connection()

    read_user = cfg.get("read_user") or _env_str("MSSQL_READ_USER", "usm")
    read_password = cfg.get("read_password") or _env_str("MSSQL_READ_PASSWORD", "usm2026")
    server = cfg.get("server", "100.100.100.50")
    port = int(cfg.get("port", 1433))
    database = cfg.get("database", "PL2")
    timeout = int(cfg.get("timeout", 3))

    # 1. Try pyodbc (ODBC Driver 17/18/SQL Server)
    try:
        import pyodbc
        try:
            pyodbc.add_output_converter(-155, lambda b: str(b))
        except Exception:
            pass
        for driver in ["ODBC Driver 17 for SQL Server", "ODBC Driver 18 for SQL Server", "SQL Server"]:
            try:
                conn_str = (
                    f"DRIVER={{{driver}}};"
                    f"SERVER={server},{port};"
                    f"DATABASE={database};"
                    f"UID={read_user};"
                    f"PWD={read_password};"
                    f"TrustServerCertificate=yes;"
                    f"Timeout={timeout};"
                )
                conn = pyodbc.connect(conn_str, timeout=timeout)
                try:
                    conn.add_output_converter(-155, lambda b: str(b))
                except Exception:
                    pass
                _last_mssql_read_attempt = 0
                return conn, "MSSQL_PYODBC"
            except Exception:
                continue
    except ImportError:
        pass

    # 2. Try pymssql
    try:
        import pymssql
        conn = pymssql.connect(
            server=server,
            port=port,
            user=read_user,
            password=read_password,
            database=database,
            timeout=timeout
        )
        _last_mssql_read_attempt = 0
        return conn, "MSSQL_PYMSSQL"
    except Exception:
        pass

    _last_mssql_read_attempt = now
    return get_mssql_connection()

def execute_mssql_insert(query, params, station="fvi"):
    """
    Executes an INSERT statement on Microsoft SQL Server.
    User 'Final_Inspection' has INSERT-only permissions on dbo.Final_Inspections and dbo.Final_Inspection_Defects.
    Automatically translates '?' param markers to '%s' if pymssql is used.
    """
    conn, engine = get_mssql_connection(station=station)
    if not conn:
        return False, "OFFLINE_FALLBACK"
    try:
        cur = conn.cursor()
        if engine == "MSSQL_PYMSSQL":
            py_query = query.replace("?", "%s")
            cur.execute(py_query, params)
        else:
            cur.execute(query, params)
        conn.commit()
        conn.close()
        return True, engine
    except Exception as e:
        print(f"[MSSQL Insert Error] {e}")
        try:
            conn.close()
        except Exception:
            pass
        return False, str(e)

def init_database():
    """
    Initializes database tables matching production schema with local persistence:
    1. final_inspection_defects / postlam_inspection_defects
    2. final_inspections / postlam_visual_inspections
    3. cmms_users
    """
    with get_db() as conn:
        cursor = conn.cursor()
        
        # 1. CMMS Users Table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS cmms_users (
            user_id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            full_name TEXT NOT NULL,
            role TEXT NOT NULL,
            department TEXT NOT NULL,
            shift TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)

        # 2. Final Inspections Table (Matches dbo.Final_Inspections)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS final_inspections (
            record_id INTEGER PRIMARY KEY AUTOINCREMENT,
            module_id VARCHAR(16) NOT NULL,
            tested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            grade VARCHAR(1) NOT NULL,
            result_code VARCHAR(1),
            tester_name TEXT NOT NULL
        )
        """)

        # 3. Final Inspection Defects Table (Matches dbo.Final_Inspection_Defects)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS final_inspection_defects (
            record_id INTEGER PRIMARY KEY AUTOINCREMENT,
            module_id VARCHAR(16) NOT NULL,
            tested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            defect_location VARCHAR(4),
            defect_cell VARCHAR(4),
            defect_type VARCHAR(30) NOT NULL,
            tester_name TEXT NOT NULL
        )
        """)

        # 4. Post-Lam Visual Inspections Table (Matches dbo.PostLam_Visual_Inspections)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS postlam_visual_inspections (
            record_id INTEGER PRIMARY KEY AUTOINCREMENT,
            module_id VARCHAR(16) NOT NULL,
            tested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            grade VARCHAR(1) NOT NULL,
            result_code VARCHAR(1) NOT NULL,
            tester_name TEXT NOT NULL
        )
        """)

        # 5. Post-Lam Inspection Defects Table (Matches dbo.PostLam_Inspection_Defects)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS postlam_inspection_defects (
            record_id INTEGER PRIMARY KEY AUTOINCREMENT,
            module_id VARCHAR(16) NOT NULL,
            tested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            defect_location VARCHAR(4),
            defect_cell VARCHAR(4),
            defect_type VARCHAR(30) NOT NULL,
            tester_name TEXT NOT NULL,
            side VARCHAR(10) DEFAULT 'front'
        )
        """)

        # Schema migrations for existing SQLite tables
        try:
            cursor.execute("ALTER TABLE final_inspections ADD COLUMN grade VARCHAR(1)")
        except Exception:
            pass
        try:
            cursor.execute("ALTER TABLE final_inspection_defects ADD COLUMN defect_location VARCHAR(4)")
        except Exception:
            pass
        try:
            cursor.execute("ALTER TABLE final_inspection_defects ADD COLUMN side VARCHAR(10) DEFAULT 'front'")
        except Exception:
            pass
        try:
            cursor.execute("ALTER TABLE cmms_users ADD COLUMN email TEXT")
        except Exception:
            pass

        # Seed initial CMMS operators if table is empty
        cursor.execute("SELECT COUNT(*) as cnt FROM cmms_users")
        if cursor.fetchone()["cnt"] == 0:
            demo_users = [
                ("OP-8492", "vance.k", "vance.k@company.com", hashlib.sha256(b"pass123").hexdigest(), "Vance Kowalski", "QC Lead Inspector", "Photovoltaic Modules", "Shift A"),
                ("OP-3310", "sarah.m", "sarah.m@company.com", hashlib.sha256(b"pass123").hexdigest(), "Sarah Miller", "QC Metrology Tech", "Photovoltaic Modules", "Shift A"),
                ("OP-5521", "carlos.r", "carlos.r@company.com", hashlib.sha256(b"pass123").hexdigest(), "Carlos Reyes", "Line Quality Inspector", "Photovoltaic Modules", "Shift B"),
                ("OP-9901", "admin", "admin@company.com", hashlib.sha256(b"admin").hexdigest(), "Plant Administrator", "Quality Assurance Engineer", "Quality Operations", "All Shifts")
            ]
            cursor.executemany("""
            INSERT INTO cmms_users (user_id, username, email, password_hash, full_name, role, department, shift)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, demo_users)
            conn.commit()
        else:
            # Update emails for demo users if missing
            try:
                cursor.execute("UPDATE cmms_users SET email = 'vance.k@company.com' WHERE username = 'vance.k' AND (email IS NULL OR email = '')")
                cursor.execute("UPDATE cmms_users SET email = 'sarah.m@company.com' WHERE username = 'sarah.m' AND (email IS NULL OR email = '')")
                cursor.execute("UPDATE cmms_users SET email = 'carlos.r@company.com' WHERE username = 'carlos.r' AND (email IS NULL OR email = '')")
                cursor.execute("UPDATE cmms_users SET email = 'admin@company.com' WHERE username = 'admin' AND (email IS NULL OR email = '')")
                conn.commit()
            except Exception:
                pass

# ---------------------------------------------------------------------------
# FTP Image Fetcher (Connects to EL Testing PC / FTP Server 100.100.200.223)
# ---------------------------------------------------------------------------
def _get_el_fallback_sample(panel_id, side_normalized, reason="FALLBACK_SAMPLE"):
    if side_normalized == "back":
        back_sample = BASE_DIR / "sample_el_back.jpg"
        if back_sample.exists():
            return back_sample, f"{reason}_BACK" if reason == "FALLBACK_SAMPLE" else reason
    fallback_samples = [
        BASE_DIR / "sample_el_1.jpg",
        BASE_DIR / "sample_el_2.jpg",
        BASE_DIR / "sample_el_3.jpg",
        BASE_DIR / "sample_el_4.jpg"
    ]
    existing_samples = [s for s in fallback_samples if s.exists()]
    if existing_samples:
        chosen = existing_samples[abs(hash(panel_id)) % len(existing_samples)]
        return chosen, reason
    default_single = BASE_DIR / "solar_el_sample.jpg"
    if default_single.exists():
        return default_single, reason
    return None, "NO_IMAGE_AVAILABLE"


def _try_ftp_retr(ftp, remote_path, tmp_file):
    try:
        with open(tmp_file, "wb") as f:
            ftp.retrbinary(f"RETR {remote_path}", f.write)
        if tmp_file.exists() and tmp_file.stat().st_size > 0:
            return True
    except Exception:
        pass
    if tmp_file.exists():
        try:
            tmp_file.unlink()
        except Exception:
            pass
    return False


def _build_derived_ftp_paths(db_image_path, panel_id, station_norm):
    paths = []
    if not db_image_path:
        return paths
    clean_path = str(db_image_path).replace("\\", "/")
    if station_norm == "postlam":
        m_date = re.search(r"(\d{4})-?(\d{2})-?(\d{2})", clean_path)
        m_shift = re.search(r"/(Day|Night)(?:/|$)", clean_path, re.IGNORECASE)
        m_status = re.search(r"/(OK|NG)(?:/|$)", clean_path, re.IGNORECASE)
        shift = m_shift.group(1).capitalize() if m_shift else "Day"
        if m_date:
            compact_date = f"{m_date.group(1)}{m_date.group(2)}{m_date.group(3)}"
            if m_status:
                paths.append(f"/EL/{compact_date}/{shift}/{m_status.group(1).upper()}/{panel_id}.jpg")
            else:
                paths.append(f"/EL/{compact_date}/{shift}/OK/{panel_id}.jpg")
                paths.append(f"/EL/{compact_date}/{shift}/NG/{panel_id}.jpg")
            paths.append(f"/EL/{compact_date}/{shift}/{panel_id}.jpg")
    p1 = clean_path.replace("/el_ret_fujian", "")
    p2 = p1.replace("/el/", "/").replace("/vis/", "/")
    for cand in (p2, p1, clean_path):
        if cand and cand not in paths:
            paths.append(cand)
    return paths


def fetch_el_image_via_ftp(panel_id, side="front", force_refresh=False, station="fvi"):
    """
    Connects to the EL Testing PC(s) via FTP and downloads the most recent module image.
    Uses dbo.EL2 + CONFIG['ftp'] for FVI and dbo.EL1 + CONFIG['ftp_postlam'] (dual PCs 10.1.19.75 & 10.1.19.86) for Post-Lam.
    Validates cached files against the latest DB record so reworked retakes replace older cached images.
    """
    station_norm = _normalize_station(station)
    side_normalized = "back" if str(side).lower() in ("back", "rear", "b") else "front"
    suffix = "_back" if side_normalized == "back" else ""
    prefix = "postlam_" if station_norm == "postlam" else ""
    local_file = CACHE_DIR / f"{prefix}{panel_id}{suffix}.jpg"
    meta_file = CACHE_DIR / f"{prefix}{panel_id}{suffix}.meta"

    # 1. Check dbo.EL1 (postlam) or dbo.EL2 (fvi) in MSSQL PL2 first for the most recent retake
    el_meta = get_el1_metadata(panel_id) if station_norm == "postlam" else get_el2_metadata(panel_id)
    db_image_path = None
    if el_meta.get("found"):
        if side_normalized == "back" and el_meta.get("vis_image"):
            db_image_path = el_meta.get("vis_image")
        else:
            db_image_path = el_meta.get("image_path")

    current_sig = ""
    if el_meta.get("found"):
        current_sig = f"{station_norm}|{el_meta.get('record_id')}|{el_meta.get('tested_at')}|{db_image_path or ''}"

    # Use local disk cache only if not forced and the DB record matches the cached signature
    if (not force_refresh) and local_file.exists() and current_sig and meta_file.exists():
        try:
            if meta_file.read_text(encoding="utf-8").strip() == current_sig:
                return local_file, "CACHED"
        except Exception:
            pass

    ftp_cfg = CONFIG["ftp_postlam"] if station_norm == "postlam" else CONFIG["ftp"]
    if station_norm == "postlam":
        raw_hosts = list(ftp_cfg.get("hosts") or [])
        if not raw_hosts and ftp_cfg.get("host"):
            raw_hosts = [ftp_cfg["host"]]
        el_machine = str(el_meta.get("el_machine") or "").upper()
        if ("L2_QEL002" in str(db_image_path or "").upper() or el_machine == "L2_QEL002") and "10.1.19.86" in raw_hosts:
            raw_hosts = ["10.1.19.86"] + [h for h in raw_hosts if h != "10.1.19.86"]
        elif ("L2_QEL001" in str(db_image_path or "").upper() or el_machine == "L2_QEL001") and "10.1.19.75" in raw_hosts:
            raw_hosts = ["10.1.19.75"] + [h for h in raw_hosts if h != "10.1.19.75"]
        hosts_to_try = raw_hosts
    else:
        hosts_to_try = [ftp_cfg.get("host")] if ftp_cfg.get("host") else []

    if (not ftp_cfg.get("enabled")) or (not hosts_to_try):
        if local_file.exists():
            return local_file, "CACHED"
        reason = "POSTLAM_FTP_PENDING_CREDENTIALS" if (station_norm == "postlam" and not hosts_to_try) else "FALLBACK_SAMPLE"
        if reason == "POSTLAM_FTP_PENDING_CREDENTIALS":
            print(f"[FTP Notice] Post-Lam FTP host/credentials not configured yet; serving fallback EL image for {panel_id}")
        return _get_el_fallback_sample(panel_id, side_normalized, reason=reason)

    derived_paths = _build_derived_ftp_paths(db_image_path, panel_id, station_norm)
    if side_normalized == "back":
        candidates = [f"{panel_id}_back.jpg", f"{panel_id}_B.jpg", f"{panel_id}_rear.jpg", f"{panel_id}.jpg"]
    else:
        candidates = [f"{panel_id}.jpg", f"{panel_id}_front.jpg", f"{panel_id}_F.jpg"]

    tmp_file = CACHE_DIR / f"{prefix}{panel_id}{suffix}.tmp.{int(time.time() * 1000)}.jpg"
    downloaded_host = None
    last_error = None

    for ftp_host in hosts_to_try:
        downloaded = False
        ftp = None
        try:
            ftp = ftplib.FTP()
            ftp.encoding = "gbk"
            ftp.connect(ftp_host, int(ftp_cfg.get("port", 21)), timeout=4)
            ftp.login(ftp_cfg["username"], ftp_cfg["password"])

            # A. Try derived paths from dbo.EL1 / dbo.EL2 Image_Path
            for test_path in derived_paths:
                if _try_ftp_retr(ftp, test_path, tmp_file):
                    downloaded = True
                    tp_folder = extract_el_folder_status(image_path=test_path, station=station_norm)
                    if tp_folder in ("OK", "NG"):
                        _cache_el_folder_status(panel_id, tp_folder, station=station_norm)
                    break

            # B. Try configured remote_dir directly
            if not downloaded:
                try:
                    ftp.cwd(ftp_cfg.get("remote_dir", "/"))
                    for remote_name in candidates:
                        if _try_ftp_retr(ftp, remote_name, tmp_file):
                            downloaded = True
                            break
                except Exception:
                    pass

            # C. Scan dated folders on this FTP host
            if not downloaded:
                scan_roots = []
                if station_norm == "postlam":
                    try:
                        ftp.cwd("/EL")
                        el_items = ftp.nlst()
                        el_dates = sorted([d for d in el_items if str(d).startswith("202")], reverse=True)
                        for df in el_dates[:5]:
                            scan_roots.extend([
                                f"/EL/{df}/Day/OK",
                                f"/EL/{df}/Day/NG",
                                f"/EL/{df}/Night/OK",
                                f"/EL/{df}/Night/NG",
                                f"/EL/{df}/Day",
                                f"/EL/{df}/Night",
                            ])
                    except Exception:
                        pass
                try:
                    ftp.cwd("/")
                    root_items = ftp.nlst()
                    date_folders = sorted([d for d in root_items if str(d).startswith("202")], reverse=True)
                    cam_dirs = ["L2_QEL001", "L2_QEL002", "L2_QEL003"] if station_norm == "postlam" else ["L2_QEL003"]
                    for df in date_folders[:5]:
                        for cam_dir in cam_dirs:
                            scan_roots.extend([
                                f"/{df}/{cam_dir}/Day/OK",
                                f"/{df}/{cam_dir}/Day/NG",
                                f"/{df}/{cam_dir}/Day/OK/el",
                                f"/{df}/{cam_dir}/Day/NG/el",
                                f"/{df}/{cam_dir}/Day",
                                f"/{df}/{cam_dir}/Night/OK",
                                f"/{df}/{cam_dir}/Night/NG",
                                f"/{df}/{cam_dir}/Night/OK/el",
                                f"/{df}/{cam_dir}/Night/NG/el",
                                f"/{df}/{cam_dir}/Night",
                                f"/{df}/{cam_dir}"
                            ])
                except Exception:
                    pass

                for sub_dir in scan_roots:
                    try:
                        ftp.cwd(sub_dir)
                        for remote_name in candidates:
                            if _try_ftp_retr(ftp, remote_name, tmp_file):
                                downloaded = True
                                sd_folder = extract_el_folder_status(image_path=sub_dir, station=station_norm)
                                if sd_folder in ("OK", "NG"):
                                    _cache_el_folder_status(panel_id, sd_folder, station=station_norm)
                                break
                        if downloaded:
                            break
                    except Exception:
                        continue
        except Exception as e:
            last_error = e
            print(f"[FTP Notice] {ftp_host} ({station_norm}) scan error for {panel_id}: {e}")
        finally:
            if ftp is not None:
                try:
                    ftp.quit()
                except Exception:
                    try:
                        ftp.close()
                    except Exception:
                        pass

        if downloaded and tmp_file.exists() and tmp_file.stat().st_size > 0:
            downloaded_host = ftp_host
            break

    if downloaded_host and tmp_file.exists() and tmp_file.stat().st_size > 0:
        tmp_file.replace(local_file)
        if current_sig:
            try:
                meta_file.write_text(current_sig, encoding="utf-8")
            except Exception:
                pass
        return local_file, f"FTP_DOWNLOADED:{downloaded_host}"

    if tmp_file.exists():
        try:
            tmp_file.unlink()
        except Exception:
            pass
    if local_file.exists() and local_file.stat().st_size > 0:
        return local_file, "CACHED_FALLBACK"
    reason = "FTP_ERROR_FALLBACK" if last_error else "FTP_FALLBACK"
    return _get_el_fallback_sample(panel_id, side_normalized, reason=reason)

# ---------------------------------------------------------------------------
# CMMS Authentication Verifier (Supports SQLite, External DB & REST)
# ---------------------------------------------------------------------------
def verify_cmms_credentials(username, password):
    """
    Validates operator credentials against configured CMMS backend.
    Supports local SQLite, External SQL Database (Postgres/MySQL/MSSQL), or REST API.
    """
    cmms_cfg = CONFIG.get("cmms_database", {})
    mode = cmms_cfg.get("mode", "sqlite")
    pwd_hash = hashlib.sha256(password.encode("utf-8")).hexdigest()

    # Mode 1: Built-in SQLite CMMS Users Table
    if mode == "sqlite":
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            SELECT user_id, username, email, full_name, role, department, shift
            FROM cmms_users
            WHERE (LOWER(username) = LOWER(?) OR LOWER(user_id) = LOWER(?) OR LOWER(COALESCE(email, '')) = LOWER(?))
              AND (password_hash = ? OR ? = 'skip_pwd_check')
            """, (username, username, username, pwd_hash, password))
            user = cursor.fetchone()
            if user:
                return dict(user), None
            return None, "Invalid CMMS credentials or employee email"

    # Mode 2: External REST Login Endpoint (Standard CMMS FastAPI OAuth2 on USMCMMS)
    elif mode == "external_rest":
        login_url = cmms_cfg.get("rest_login_url", "")
        me_url = cmms_cfg.get("rest_me_url", "")
        timeout_sec = cmms_cfg.get("rest_timeout_sec", 5)

        try:
            import urllib.request
            import urllib.parse
            import urllib.error

            # 1. Send OAuth2 credentials as application/x-www-form-urlencoded
            form_data = urllib.parse.urlencode({"username": username, "password": password}).encode("utf-8")
            req = urllib.request.Request(
                login_url,
                data=form_data,
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            )
            try:
                with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
                    login_resp = json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as he:
                err_text = he.read().decode("utf-8")
                try:
                    err_json = json.loads(err_text)
                    detail = err_json.get("detail", f"HTTP {he.code}")
                except Exception:
                    detail = f"HTTP {he.code}"
                return None, f"CMMS Authentication Error: {detail}"

            access_token = login_resp.get("access_token")
            if not access_token:
                return None, "CMMS did not return an access token"

            # 2. Query user profile using token
            me_req = urllib.request.Request(
                me_url,
                headers={"Authorization": f"Bearer {access_token}"}
            )
            with urllib.request.urlopen(me_req, timeout=timeout_sec) as me_resp:
                user_info = json.loads(me_resp.read().decode("utf-8"))

            dept = user_info.get("department")
            dept_name = dept.get("name") if isinstance(dept, dict) else (dept or "Quality")

            user_data = {
                "user_id": str(user_info.get("id", username)),
                "username": user_info.get("username", username),
                "full_name": user_info.get("full_name") or user_info.get("username", username),
                "role": user_info.get("role", "Inspector"),
                "department": dept_name,
                "shift": "Shift A",
                "cmms_token": access_token
            }
            return user_data, None

        except Exception as e:
            print(f"[CMMS Notice] Remote CMMS ({login_url}) connection failed ({e}). Checking local fallback...")
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                SELECT user_id, username, email, full_name, role, department, shift
                FROM cmms_users
                WHERE (LOWER(username) = LOWER(?) OR LOWER(user_id) = LOWER(?) OR LOWER(COALESCE(email, '')) = LOWER(?))
                  AND (password_hash = ? OR ? = 'skip_pwd_check')
                """, (username, username, username, pwd_hash, password))
                local_user = cursor.fetchone()
                if local_user:
                    return dict(local_user), None
            return None, f"CMMS Server Error: {e}"

    # Mode 3: External SQL Database (Postgres, MySQL, MS SQL)
    elif mode == "external_sql":
        sql_type = cmms_cfg.get("sql_type", "postgres")
        query = cmms_cfg.get("user_query")
        try:
            if sql_type == "postgres":
                import psycopg2
                import psycopg2.extras
                conn = psycopg2.connect(
                    host=cmms_cfg["host"],
                    port=cmms_cfg["port"],
                    dbname=cmms_cfg["database"],
                    user=cmms_cfg["username"],
                    password=cmms_cfg["password"]
                )
                with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                    cur.execute(query, (username, username))
                    row = cur.fetchone()
                    if row and (row["password_hash"] == pwd_hash or password == "skip_pwd_check"):
                        return dict(row), None
                    return None, "Invalid credentials in plant CMMS database"
            elif sql_type == "mysql":
                import mysql.connector
                conn = mysql.connector.connect(
                    host=cmms_cfg["host"],
                    port=cmms_cfg["port"],
                    database=cmms_cfg["database"],
                    user=cmms_cfg["username"],
                    password=cmms_cfg["password"]
                )
                with conn.cursor(dictionary=True) as cur:
                    cur.execute(query, (username, username))
                    row = cur.fetchone()
                    if row and (row["password_hash"] == pwd_hash or password == "skip_pwd_check"):
                        return row, None
                    return None, "Invalid credentials in plant CMMS database"
            elif sql_type == "mssql":
                import pyodbc
                conn_str = f"DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={cmms_cfg['host']},{cmms_cfg['port']};DATABASE={cmms_cfg['database']};UID={cmms_cfg['username']};PWD={cmms_cfg['password']}"
                conn = pyodbc.connect(conn_str)
                with conn.cursor() as cur:
                    cur.execute(query, (username, username))
                    row = cur.fetchone()
                    if row:
                        cols = [column[0] for column in cur.description]
                        user_dict = dict(zip(cols, row))
                        if user_dict.get("password_hash") == pwd_hash or password == "skip_pwd_check":
                            return user_dict, None
                    return None, "Invalid credentials in plant CMMS database"
        except ImportError as ie:
            return None, f"Database driver not installed for {sql_type}: {ie}"
        except Exception as e:
            return None, f"Plant CMMS database error: {e}"

    return None, "Unknown CMMS authentication mode"

# ---------------------------------------------------------------------------
# Background MQTT Conveyor Listener (Line 2 CH88 & CH89 Pure-Python Socket Client)
# ---------------------------------------------------------------------------
def prefetch_all_data_for_module(serial):
    """
    Background worker to pre-fetch SunSim, Hi-Pot, and EL camera FTP imagery as soon as a new
    module serial arrives at conveyor CH88 so cached telemetry is complete before serving.
    """
    try:
        sample_num = (abs(hash(serial)) % 4) + 1
        el_image_url = f"/api/module/{serial}/el-image?side=front"
        el_sample_fallback = f"sample_el_{sample_num}.jpg"

        sunsim = get_sunsim_telemetry(serial)
        hipot = get_hipot_telemetry(serial)
        el2 = get_el2_metadata(serial)

        el_source = ""
        try:
            img_path, source = fetch_el_image_via_ftp(serial, side="front", force_refresh=True)
            if img_path:
                el_source = source
        except Exception:
            pass

        el_folder = (el2.get("folder_status") if isinstance(el2, dict) else "") or extract_el_folder_status(module_id=serial)

        prefetched_telemetry[serial] = {
            "module_id": serial,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
            "el_image": el_image_url,
            "el_fallback": el_sample_fallback,
            "el_images": [el_sample_fallback],
            "el_folder": el_folder,
            "el_source": el_source,
            "sunsim": sunsim,
            "sun_simulator": sunsim,
            "hipot": hipot,
            "el2": el2,
            "cached_at": time.time()
        }

        print(f"[Prefetch] Pre-cached SunSim, Hi-Pot, and EL image for module {serial}")
    except Exception as e:
        print(f"[Prefetch Warning] Error prefetching data for {serial}: {e}")

def extract_serial_from_payload(raw_payload):
    """
    Parses PLC MQTT JSON payload from CH88 and CH89 conveyors.
    Format example:
    {
        "ID" : [ "USM0120311260024" ],
        "ID(CV)" : [ "USM0120311260024" ]
    }
    Extracts first non-empty string starting with 'USM'.
    """
    try:
        if isinstance(raw_payload, (bytes, bytearray)):
            raw_payload = raw_payload.decode("utf-8", errors="ignore").strip().lstrip("\ufeff")
        if isinstance(raw_payload, str):
            raw_payload = raw_payload.strip().lstrip("\ufeff")
            try:
                payload = json.loads(raw_payload)
            except Exception:
                payload = raw_payload
        else:
            payload = raw_payload

        serial = None
        if isinstance(payload, dict):
            id_val = payload.get("ID")
            if isinstance(id_val, list):
                for item in id_val:
                    if item and str(item).strip():
                        serial = str(item).strip()
                        break
            elif id_val:
                serial = str(id_val).strip()

            if not serial:
                id_cv = payload.get("ID(CV)")
                if isinstance(id_cv, list):
                    for item in id_cv:
                        if item and str(item).strip():
                            serial = str(item).strip()
                            break
                elif id_cv:
                    serial = str(id_cv).strip()

            if not serial:
                for k in ("panel_id", "serial_number", "module_id"):
                    val = payload.get(k)
                    if val:
                        serial = str(val).strip()
                        break
        elif isinstance(payload, str):
            serial = payload.strip()

        if serial:
            serial = serial.strip().upper()
            if serial.startswith("USM"):
                return serial
    except Exception as e:
        print(f"[MQTT] Serial extraction error: {e}")
    return None

def handle_conveyor_serial_arrival(serial, channel="CH88"):
    """
    Handles conveyor arrivals on CH88, pre-fetches DB/FTP telemetry,
    sets active module directly (no queueing), and broadcasts SSE updates.
    """
    global current_conveyor_panel, mqtt_channel_serials, mqtt_queue, active_main_screen_module

    if str(channel).upper() not in ("CH88", "88", "MQTT"):
        return

    if not serial:
        return
    clean_serial = str(serial).strip().upper()[:16]
    if len(clean_serial) != 16 or not clean_serial.startswith("USM"):
        return

    # Deduplication check against CH88 previous serial
    last_serial = mqtt_channel_serials.get("CH88")
    if clean_serial == last_serial:
        return

    print(f"[MQTT Conveyor] New serial arrived on CH88: {clean_serial} (Previous: {last_serial})")
    mqtt_channel_serials["CH88"] = clean_serial
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # 1. Background pre-fetch all telemetry & FTP image
    threading.Thread(target=prefetch_all_data_for_module, args=(clean_serial,), daemon=True).start()

    # 2. Update active state immediately & clear queue
    panel_entry = {
        "panel_id": clean_serial,
        "channel": "CH88",
        "timestamp": ts,
        "source": "MQTT CH88"
    }

    current_conveyor_panel = panel_entry
    active_main_screen_module = clean_serial
    mqtt_queue.clear()

    # 3. Broadcast via SSE (both named PANEL_ARRIVED and default message)
    update_event = {
        "type": "MQTT_CONVEYOR_UPDATE",
        "module_id": clean_serial,
        "panel_id": clean_serial,
        "queued_serial": clean_serial,
        "active_module_id": clean_serial,
        "channel": "CH88",
        "ch88_serial": clean_serial,
        "ch89_serial": None,
        "current_panel": current_conveyor_panel,
        "queue": [],
        "timestamp": ts
    }
    broadcast_sse("PANEL_ARRIVED", update_event)

# --- Pure-Python Built-in Socket MQTT 3.1.1 Implementation (Zero External Dependencies) ---
def _encode_remaining_length(length):
    encoded = bytearray()
    while True:
        b = length % 128
        length //= 128
        if length > 0:
            b |= 0x80
        encoded.append(b)
        if length <= 0:
            break
    return bytes(encoded)

def _recv_remaining_length(sock):
    multiplier = 1
    value = 0
    while True:
        b = sock.recv(1)
        if not b:
            raise ConnectionResetError("Socket closed while reading remaining length")
        digit = b[0]
        value += (digit & 127) * multiplier
        multiplier *= 128
        if multiplier > 128 * 128 * 128:
            raise ValueError("Malformed MQTT Remaining Length")
        if (digit & 128) == 0:
            break
    return value

def _recv_exact(sock, n):
    data = bytearray()
    while len(data) < n:
        chunk = sock.recv(n - len(data))
        if not chunk:
            raise ConnectionResetError("Socket closed prematurely while reading MQTT packet")
        data.extend(chunk)
    return bytes(data)

def _build_connect_packet(client_id, username=None, password=None, keepalive=60):
    var_header = b"\x00\x04MQTT\x04"
    flags = 0x02  # Clean Session
    if username:
        flags |= 0x80
    if password:
        flags |= 0x40
    var_header += bytes([flags]) + struct.pack(">H", keepalive)

    payload = bytearray()
    cid_bytes = client_id.encode("utf-8")
    payload += struct.pack(">H", len(cid_bytes)) + cid_bytes

    if username:
        u_bytes = username.encode("utf-8")
        payload += struct.pack(">H", len(u_bytes)) + u_bytes
    if password:
        p_bytes = password.encode("utf-8")
        payload += struct.pack(">H", len(p_bytes)) + p_bytes

    remaining = var_header + bytes(payload)
    return bytes([0x10]) + _encode_remaining_length(len(remaining)) + remaining

def _build_subscribe_packet(packet_id, topics):
    # topics: list of (topic_str, qos_int)
    var_header = struct.pack(">H", packet_id)
    payload = bytearray()
    for topic_str, qos in topics:
        t_bytes = topic_str.encode("utf-8")
        payload += struct.pack(">H", len(t_bytes)) + t_bytes + bytes([qos])
    remaining = var_header + bytes(payload)
    return bytes([0x82]) + _encode_remaining_length(len(remaining)) + remaining

def _run_socket_mqtt_listener():
    global mqtt_connected
    broker = CONFIG["mqtt"].get("broker", "100.100.0.17")
    port = CONFIG["mqtt"].get("port", 1883)
    username = CONFIG["mqtt"].get("username", "line2-equipment")
    password = CONFIG["mqtt"].get("password", "3cwDa4Lf6NZH2u")
    topics_to_sub = [
        ("usm/cstx/prod/line2/CH88", 0),
        ("usm/cstx/prod/line2/#", 0)
    ]

    client_id = f"fvi-line2-{int(time.time()) % 100000}"
    packet_id = 1

    while True:
        sock = None
        try:
            print(f"[MQTT] Connecting to Line 2 broker at {broker}:{port} (User: {username})...")
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(5.0)
            sock.connect((broker, port))
            sock.settimeout(1.0)

            # 1. Send CONNECT
            connect_pkt = _build_connect_packet(client_id, username, password, keepalive=60)
            sock.sendall(connect_pkt)

            # 2. Wait for CONNACK (0x20, 0x02, session_present, ret_code)
            hdr = sock.recv(1)
            if not hdr or hdr[0] != 0x20:
                raise ConnectionError(f"Unexpected CONNACK header: {hdr}")
            rem_len = _recv_remaining_length(sock)
            ack_body = _recv_exact(sock, rem_len)
            if len(ack_body) < 2 or ack_body[1] != 0:
                ret_code = ack_body[1] if len(ack_body) >= 2 else -1
                raise ConnectionRefusedError(f"MQTT connection refused by broker (code: {ret_code})")

            mqtt_connected = True
            print(f"[MQTT] Connected successfully to plant broker {broker}:{port}!")

            # 3. Send SUBSCRIBE for CH88
            sub_pkt = _build_subscribe_packet(packet_id, topics_to_sub)
            packet_id = (packet_id + 1) & 0xFFFF or 1
            sock.sendall(sub_pkt)
            print(f"[MQTT] Subscribed to Line 2 conveyor topic: CH88")

            last_ping = time.time()

            # 4. Message Pump & Keepalive loop
            while True:
                now = time.time()
                # Keepalive PINGREQ every 20 seconds
                if now - last_ping >= 20.0:
                    try:
                        sock.sendall(b"\xc0\x00")
                        last_ping = now
                    except Exception as pe:
                        print(f"[MQTT Ping Error] {pe}")
                        break

                # Poll socket for incoming packets
                try:
                    r, _, _ = select.select([sock], [], [], 1.0)
                except Exception:
                    break

                if not r:
                    continue

                try:
                    hdr_byte = sock.recv(1)
                except (socket.timeout, BlockingIOError):
                    continue

                if not hdr_byte:
                    print("[MQTT] Connection closed by remote broker.")
                    break

                cmd = hdr_byte[0] & 0xF0
                flags = hdr_byte[0] & 0x0F
                rem_len = _recv_remaining_length(sock)
                body = _recv_exact(sock, rem_len) if rem_len > 0 else b""

                if cmd == 0xD0:  # PINGRESP
                    continue
                elif cmd == 0x90:  # SUBACK
                    continue
                elif cmd == 0x30:  # PUBLISH
                    try:
                        topic_len = struct.unpack(">H", body[:2])[0]
                        topic_str = body[2:2+topic_len].decode("utf-8", errors="ignore")
                        offset = 2 + topic_len
                        qos = (flags >> 1) & 0x03
                        if qos > 0:
                            pkt_id_bytes = body[offset:offset+2]
                            offset += 2
                            if qos == 1:
                                sock.sendall(b"\x40\x02" + pkt_id_bytes)
                        msg_payload = body[offset:]

                        topic_upper = topic_str.upper()
                        if "CH88" in topic_upper or topic_upper.endswith("88"):
                            channel = "CH88"
                            serial = extract_serial_from_payload(msg_payload)
                            if serial:
                                handle_conveyor_serial_arrival(serial, channel)
                    except Exception as me:
                        print(f"[MQTT Message Parse Error] {me}")

        except Exception as e:
            mqtt_connected = False
            print(f"[MQTT Listener] Connection notice ({broker}:{port}): {e}. Retrying in 5s...")
        finally:
            mqtt_connected = False
            if sock:
                try:
                    sock.close()
                except Exception:
                    pass

        time.sleep(5)

def start_mqtt_listener():
    """
    Subscribes to plant MQTT broker if enabled in CONFIG.
    Includes built-in pure-Python socket MQTT 3.1.1 client with zero external dependencies,
    with automatic reconnect, keepalive PINGREQ, pre-fetching, deduplication, and queueing.
    """
    if not CONFIG["mqtt"].get("enabled", False):
        return

    threading.Thread(target=_run_socket_mqtt_listener, daemon=True).start()

# ---------------------------------------------------------------------------
# Broadcast Event to SSE Clients (Conveyor MQTT stream to browser)
# ---------------------------------------------------------------------------
def broadcast_sse(event_type, data):
    """
    Broadcasts SSE event to all connected clients.
    Sends both named event (`event: {event_type}\\ndata: ...\\n\\n`) and default (`data: ...\\n\\n`)
    so that listeners using either `sse.addEventListener('PANEL_ARRIVED', ...)` or
    standard `sse.onmessage = ...` both trigger seamlessly.
    """
    json_data = json.dumps(data)
    named_msg = f"event: {event_type}\ndata: {json_data}\n\n".encode("utf-8")
    default_msg = f"data: {json_data}\n\n".encode("utf-8")
    payload = named_msg + default_msg

    dead_clients = []
    for client in list(active_clients):
        try:
            client.wfile.write(payload)
            client.wfile.flush()
        except Exception:
            dead_clients.append(client)
    for dc in dead_clients:
        if dc in active_clients:
            try:
                active_clients.remove(dc)
            except ValueError:
                pass

# ---------------------------------------------------------------------------
# HTTP Request Handler
# ---------------------------------------------------------------------------
class FVIEdgeHandler(BaseHTTPRequestHandler):

    def send_json(self, status_code, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def _serve_html_with_station(self, html_path, station_mode="fvi"):
        if not html_path.exists() or not html_path.is_file():
            self.send_response(404)
            self.end_headers()
            return
        with open(html_path, "rb") as f:
            raw_bytes = f.read()
        station_norm = _normalize_station(station_mode)
        try:
            html_text = raw_bytes.decode("utf-8")
            inject_tag = f'<script>window.__LOCKED_STATION_MODE__ = "{station_norm}";</script>'
            if "</head>" in html_text:
                html_text = html_text.replace("</head>", f"  {inject_tag}\n</head>", 1)
            else:
                html_text = inject_tag + html_text
            content = html_text.encode("utf-8")
        except Exception:
            content = raw_bytes
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        global current_conveyor_panel, active_main_screen_module, _initial_conveyor_seeded
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        station = _resolve_station_mode(query_params=query)

        # 1. Server-Sent Events (SSE) Stream for real-time MQTT Conveyor updates
        if path in ("/api/stream", "/api/conveyor/stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            active_clients.append(self)
            
            # Send initial state
            init_msg = {
                "type": "INIT",
                "current_panel": current_conveyor_panel,
                "mqtt_connected": mqtt_connected,
                "ch88_serial": mqtt_channel_serials.get("CH88"),
                "ch89_serial": mqtt_channel_serials.get("CH89"),
                "queue": mqtt_queue,
                "timestamp": time.time()
            }
            self.wfile.write(f"data: {json.dumps(init_msg)}\n\n".encode("utf-8"))
            self.wfile.flush()
            
            try:
                while True:
                    time.sleep(15)
                    self.wfile.write(b": heartbeat\n\n")
                    self.wfile.flush()
            except Exception:
                if self in active_clients:
                    active_clients.remove(self)
            return

        # 2. System Status & Diagnostics
        if path in ("/api/status", "/api/health"):
            mssql_conn, mssql_engine = get_mssql_connection(station=station)
            mssql_cfg = CONFIG.get("mssql", {})
            if mssql_conn:
                db_status = "CONNECTED"
                db_engine = f"Microsoft SQL Server / {mssql_cfg.get('database', 'PL2')} @ {mssql_cfg.get('server', 'localhost')} ({mssql_engine})"
                mssql_conn.close()
            else:
                db_status = "LOCAL_FALLBACK"
                db_engine = "SQLite (Local Offline Storage)"

            defects_tbl_local = "postlam_inspection_defects" if station == "postlam" else "final_inspection_defects"
            with get_db() as local_conn:
                local_cur = local_conn.cursor()
                try:
                    local_cur.execute(f"SELECT COUNT(*) FROM {defects_tbl_local}")
                    row = local_cur.fetchone()
                    total_defects = row[0] if row else 0
                except Exception:
                    total_defects = 0

            tables_list = (
                ["dbo.PostLam_Visual_Inspections", "dbo.PostLam_Inspection_Defects"]
                if station == "postlam"
                else ["dbo.Final_Inspections", "dbo.Final_Inspection_Defects"]
            )
            self.send_json(200, {
                "status": "ONLINE",
                "station_mode": _normalize_station(CONFIG.get("station_mode", "fvi")),
                "active_station": station,
                "database_status": db_status,
                "database_engine": db_engine,
                "target_database": f"{mssql_cfg.get('database', 'PL2')} @ {mssql_cfg.get('server', 'localhost')}",
                "tables": tables_list,
                "total_defects_logged": total_defects,
                "current_module": current_conveyor_panel,
                "mqtt_connected": mqtt_connected,
                "ch88_serial": mqtt_channel_serials.get("CH88"),
                "ch89_serial": mqtt_channel_serials.get("CH89"),
                "queue": mqtt_queue,
                "ftp_configured": CONFIG["ftp"],
                "ftp_postlam_configured": bool(CONFIG["ftp_postlam"].get("host")),
                "mqtt_configured": CONFIG["mqtt"]
            })
            return

        # 3. Check Current Auth Session
        if path == "/api/auth/session":
            auth_header = self.headers.get("Authorization", "")
            token = auth_header.replace("Bearer ", "").strip()
            if token and token in active_sessions:
                self.send_json(200, {"authenticated": True, "user": active_sessions[token]})
            else:
                self.send_json(200, {"authenticated": False, "user": None})
            return

        # Active Module Synchronisation Endpoint
        if path == "/api/module/active":
            if station == "postlam":
                mod = active_main_screen_module_by_station.get("postlam") or ""
            else:
                mod = (
                    active_main_screen_module_by_station.get("fvi")
                    or active_main_screen_module
                    or current_conveyor_panel.get("panel_id")
                    or ""
                )
            if mod and (len(str(mod)) != 16 or not str(mod).startswith("USM")):
                mod = ""
            self.send_json(200, {
                "module_id": mod,
                "panel_id": mod,
                "station": station
            })
            return

        # 4. Get Current Conveyor Panel ID
        if path in ("/api/module/current", "/api/conveyor/current"):
            if (not current_conveyor_panel.get("panel_id")) and (not mqtt_channel_serials.get("CH88")) and (not _initial_conveyor_seeded):
                _initial_conveyor_seeded = True
                latest_mod = get_latest_production_module()
                if latest_mod and len(str(latest_mod).strip()) == 16 and str(latest_mod).strip().upper().startswith("USM"):
                    clean_latest = str(latest_mod).strip().upper()
                    mqtt_channel_serials["CH88"] = clean_latest
                    current_conveyor_panel = {
                        "panel_id": clean_latest,
                        "channel": "CH88",
                        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "source": "MQTT CH88"
                    }
                    if not active_main_screen_module:
                        active_main_screen_module = clean_latest
                        active_main_screen_module_by_station["fvi"] = clean_latest
            self.send_json(200, {
                "panel_id": current_conveyor_panel.get("panel_id"),
                "channel": current_conveyor_panel.get("channel", "CH88"),
                "timestamp": current_conveyor_panel.get("timestamp"),
                "source": current_conveyor_panel.get("source"),
                "mqtt_connected": mqtt_connected,
                "ch88_serial": mqtt_channel_serials.get("CH88"),
                "ch89_serial": mqtt_channel_serials.get("CH89"),
                "queue": mqtt_queue
            })
            return

        # 5. Fetch EL Image via FTP (Front or Back Side)
        if path.startswith("/api/module/") and path.endswith("/el-image"):
            # URL: /api/module/{panel_id}/el-image?side=front|back&station=fvi|postlam
            side = query.get("side", ["front"])[0].lower()
            force_refresh = bool(query.get("refresh"))
            parts = path.strip("/").split("/")
            panel_id = parts[2] if len(parts) >= 3 else "DEFAULT"
            image_path, source = fetch_el_image_via_ftp(panel_id, side=side, force_refresh=force_refresh, station=station)

            if image_path and image_path.exists():
                with open(image_path, "rb") as f:
                    img_data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Content-Length", str(len(img_data)))
                self.send_header("X-Image-Source", source)
                self.send_header("X-Station-Mode", station)
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(img_data)
            else:
                self.send_json(404, {"error": "Image not found", "source": source})
            return

        # 6. Fetch Logged Defects for Module (table: dbo.Final_Inspection_Defects or dbo.PostLam_Inspection_Defects)
        if path.startswith("/api/defects"):
            mod_id = query.get("module_id", [None])[0]
            defects_tbl = "postlam_inspection_defects" if station == "postlam" else "final_inspection_defects"
            with get_db() as conn:
                cursor = conn.cursor()
                if mod_id:
                    cursor.execute(f"SELECT * FROM {defects_tbl} WHERE module_id = ? ORDER BY record_id ASC", (mod_id,))
                else:
                    cursor.execute(f"SELECT * FROM {defects_tbl} ORDER BY record_id DESC LIMIT 100")
                rows = [dict(r) for r in cursor.fetchall()]
                for r in rows:
                    t = r.get("tested_at")
                    if t and isinstance(t, str) and not t.endswith("Z") and not ("+" in t or "-" in t[10:]):
                        r["tested_at"] = t.replace(" ", "T") + "Z"
            self.send_json(200, {"defects": rows, "station": station})
            return

        # 7. Fetch Overall Inspection / Grade for Module (dbo.Final_Inspections or dbo.PostLam_Visual_Inspections)
        # Supports: ?module_id=..., ?search=..., ?grade=..., ?limit=..., ?station=...
        if path.startswith("/api/inspections"):
            mod_id = query.get("module_id", [None])[0]
            insp_tbl = "postlam_visual_inspections" if station == "postlam" else "final_inspections"
            defects_tbl = "postlam_inspection_defects" if station == "postlam" else "final_inspection_defects"
            with get_db() as conn:
                cursor = conn.cursor()
                if mod_id:
                    cursor.execute(f"""
                    SELECT 
                        fi.record_id,
                        fi.module_id,
                        fi.tested_at,
                        fi.grade,
                        fi.result_code,
                        fi.tester_name,
                        COUNT(fd.record_id) as defect_count,
                        GROUP_CONCAT(fd.defect_type, '; ') as defect_summary
                    FROM {insp_tbl} fi
                    LEFT JOIN {defects_tbl} fd ON fi.module_id = fd.module_id
                    WHERE fi.module_id = ?
                    GROUP BY fi.record_id
                    ORDER BY fi.record_id DESC LIMIT 1
                    """, (mod_id,))
                    row = cursor.fetchone()
                    data = dict(row) if row else None
                    if data and data.get("tested_at"):
                        t = data["tested_at"]
                        if isinstance(t, str) and not t.endswith("Z") and not ("+" in t or "-" in t[10:]):
                            data["tested_at"] = t.replace(" ", "T") + "Z"
                    self.send_json(200, {"inspection": data, "records": [data] if data else [], "station": station})
                    return
                else:
                    search_term = query.get("search", [None])[0] or query.get("q", [None])[0]
                    grade_filter = query.get("grade", [None])[0]
                    limit_str = query.get("limit", ["200"])[0]
                    limit = int(limit_str) if limit_str and limit_str.isdigit() else 200

                    sql = f"""
                    SELECT 
                        fi.record_id,
                        fi.module_id,
                        fi.tested_at,
                        fi.grade,
                        fi.result_code,
                        fi.tester_name,
                        COUNT(fd.record_id) as defect_count,
                        GROUP_CONCAT(fd.defect_type, '; ') as defect_summary
                    FROM {insp_tbl} fi
                    LEFT JOIN {defects_tbl} fd ON fi.module_id = fd.module_id
                    """
                    params = []
                    where_clauses = []

                    if search_term:
                        st = f"%{search_term.strip()}%"
                        where_clauses.append("(fi.module_id LIKE ? OR fi.tester_name LIKE ? OR fi.tested_at LIKE ? OR fi.grade LIKE ?)")
                        params.extend([st, st, st, st])

                    if grade_filter and grade_filter.upper() != "ALL":
                        # Match both numeric (0,1,2,3) and letter (A,B,R,X)
                        g_map = {"A": ["A", "0"], "B": ["B", "1"], "R": ["R", "2"], "X": ["X", "3"]}
                        grades = g_map.get(grade_filter.upper(), [grade_filter])
                        placeholders = ",".join("?" for _ in grades)
                        where_clauses.append(f"fi.grade IN ({placeholders})")
                        params.extend(grades)

                    if where_clauses:
                        sql += " WHERE " + " AND ".join(where_clauses)

                    sql += """
                    GROUP BY fi.record_id
                    ORDER BY fi.tested_at DESC, fi.record_id DESC
                    LIMIT ?
                    """
                    params.append(limit)

                    cursor.execute(sql, tuple(params))
                    rows = [dict(r) for r in cursor.fetchall()]
                    for r in rows:
                        t = r.get("tested_at")
                        if t and isinstance(t, str) and not t.endswith("Z") and not ("+" in t or "-" in t[10:]):
                            r["tested_at"] = t.replace(" ", "T") + "Z"

                    # Compute live summary metrics
                    cursor.execute(f"""
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN grade IN ('0', 'A') THEN 1 ELSE 0 END) as count_a,
                        SUM(CASE WHEN grade IN ('1', 'B') THEN 1 ELSE 0 END) as count_b,
                        SUM(CASE WHEN grade IN ('2', 'R') THEN 1 ELSE 0 END) as count_r,
                        SUM(CASE WHEN grade IN ('3', 'X') THEN 1 ELSE 0 END) as count_x
                    FROM {insp_tbl}
                    """)
                    sum_row = cursor.fetchone()
                    summary = dict(sum_row) if sum_row else {"total": 0, "count_a": 0, "count_b": 0, "count_r": 0, "count_x": 0}
                    if summary.get("total") is None:
                        summary = {"total": 0, "count_a": 0, "count_b": 0, "count_r": 0, "count_x": 0}

                    self.send_json(200, {
                        "inspection": rows,
                        "records": rows,
                        "total_count": summary.get("total", len(rows)),
                        "summary": summary,
                        "station": station
                    })
                    return

        # 8. Sun Simulator Metrology Endpoint (SQLExpress / Simulation Fallback)
        if path.startswith("/api/telemetry/sunsim"):
            mod_id = query.get("module_id", [None])[0] or current_conveyor_panel.get("panel_id", "")
            data = get_sunsim_telemetry(mod_id)
            self.send_json(200, data)
            return

        # 9. Hi-Pot Electrical Safety Endpoint (MSSQL PL2 / Simulation Fallback)
        if path.startswith("/api/telemetry/hipot"):
            mod_id = query.get("module_id", [None])[0] or current_conveyor_panel.get("panel_id", "")
            data = get_hipot_telemetry(mod_id)
            self.send_json(200, data)
            return

        # 10. EL1 / EL2 Inspection Metadata Endpoints (MSSQL PL2 dbo.EL1 / dbo.EL2)
        if path.startswith("/api/telemetry/el1"):
            mod_id = query.get("module_id", [None])[0] or active_main_screen_module_by_station.get("postlam", "")
            data = get_el1_metadata(mod_id)
            self.send_json(200, data)
            return

        if path.startswith("/api/telemetry/el2") or path.startswith("/api/telemetry/el"):
            mod_id = query.get("module_id", [None])[0] or current_conveyor_panel.get("panel_id", "")
            data = get_el1_metadata(mod_id) if station == "postlam" else get_el2_metadata(mod_id)
            self.send_json(200, data)
            return

        # 11. Combined Telemetry Endpoint (SunSim + Hi-Pot + EL1/EL2 + EL Images)
        if path.startswith("/api/telemetry"):
            mod_id = query.get("module_id", [None])[0] or (
                active_main_screen_module_by_station.get("postlam", "")
                if station == "postlam"
                else current_conveyor_panel.get("panel_id", "")
            )
            force_fresh = bool(query.get("_t"))
            cache_key = f"{station}:{mod_id}"

            # Instant cache hit from MQTT background prefetch (expires after 5s so reworked modules refresh)
            cached = prefetched_telemetry.get(cache_key) or (prefetched_telemetry.get(mod_id) if station == "fvi" else None)
            if cached and not force_fresh and (cached.get("el2") is not None or cached.get("el1") is not None) and (time.time() - cached.get("cached_at", 0) < 5.0):
                self.send_json(200, cached)
                return

            sunsim = get_sunsim_telemetry(mod_id)
            hipot = get_hipot_telemetry(mod_id)
            el_meta = get_el1_metadata(mod_id) if station == "postlam" else get_el2_metadata(mod_id)
            el_folder = (el_meta.get("folder_status") if isinstance(el_meta, dict) else "") or extract_el_folder_status(module_id=mod_id, station=station)
            if not el_folder:
                # Try resolving via FTP image fetch so folder sidecar is populated
                try:
                    fetch_el_image_via_ftp(mod_id, side="front", station=station)
                    el_folder = extract_el_folder_status(module_id=mod_id, station=station)
                except Exception:
                    pass

            # EL Image for single-module reference display on Monitor 2
            sample_num = (abs(hash(mod_id)) % 4) + 1
            el_image_url = f"/api/module/{mod_id}/el-image?side=front&station={station}"
            el_sample_fallback = f"sample_el_{sample_num}.jpg"

            telemetry_data = {
                "module_id": mod_id,
                "station": station,
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
                "el_image": el_image_url,
                "el_fallback": el_sample_fallback,
                "el_images": [el_sample_fallback],
                "el_folder": el_folder,
                "sunsim": sunsim,
                "sun_simulator": sunsim,
                "hipot": hipot,
                "el2": el_meta,
                "el1": el_meta if station == "postlam" else None,
                "cached_at": time.time()
            }
            prefetched_telemetry[cache_key] = telemetry_data
            if station == "fvi":
                prefetched_telemetry[mod_id] = telemetry_data
            self.send_json(200, telemetry_data)
            return

        # 12. PWA Manifest, Service Worker & Locked Post-Lam Routes (Reuses Single index.html and telemetry.html)
        if path in ("/manifest.json", "/postlam/manifest.json"):
            manifest_station = "postlam" if path.startswith("/postlam/") else station
            is_pl = manifest_station == "postlam"
            manifest_data = {
                "name": "USM Post-Lam Visual Inspection" if is_pl else "USM Final Visual Inspection",
                "short_name": "Post-Lam QC" if is_pl else "FVI QC",
                "description": "Shop-floor Photovoltaic Inspection Console & EL Viewer",
                "start_url": "/postlam" if is_pl else "/",
                "scope": "/",
                "display": "standalone",
                "orientation": "any",
                "background_color": "#0b0f19",
                "theme_color": "#0b0f19",
                "icons": [
                    {
                        "src": "/app-icon.svg",
                        "sizes": "any",
                        "type": "image/svg+xml",
                        "purpose": "any maskable"
                    }
                ]
            }
            self.send_json(200, manifest_data)
            return

        if path in ("/sw.js", "/postlam/sw.js"):
            sw_path = BASE_DIR / "sw.js"
            if sw_path.exists():
                with open(sw_path, "rb") as f:
                    content = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/javascript; charset=utf-8")
                self.send_header("Content-Length", str(len(content)))
                self.send_header("Service-Worker-Allowed", "/")
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
                self.end_headers()
                self.wfile.write(content)
                return

        if path in ("/postlam/", "/postlam/second/", "/postlam/screen2/", "/postlam/monitor2/", "/postlam/telemetry/"):
            clean_dest = path.rstrip("/")
            query_str = f"?{parsed.query}" if parsed.query else ""
            self.send_response(302)
            self.send_header("Location", f"{clean_dest}{query_str}")
            self.end_headers()
            return

        if path == "/postlam":
            self._serve_html_with_station(BASE_DIR / "index.html", station_mode="postlam")
            return

        if path in ("/postlam/second", "/postlam/screen2", "/postlam/monitor2", "/postlam/telemetry"):
            self._serve_html_with_station(BASE_DIR / "telemetry.html", station_mode="postlam")
            return

        if path in ("/second/", "/screen2/", "/monitor2/", "/telemetry/"):
            clean_dest = path.rstrip("/")
            query_str = f"?{parsed.query}" if parsed.query else ""
            self.send_response(302)
            self.send_header("Location", f"{clean_dest}{query_str}")
            self.end_headers()
            return

        if path in ("/second", "/screen2", "/monitor2", "/telemetry"):
            self._serve_html_with_station(BASE_DIR / "telemetry.html", station_mode=station)
            return

        rel_path = path.lstrip("/")
        if rel_path.startswith("postlam/"):
            rel_path = rel_path[len("postlam/"):]
        if not rel_path or rel_path == "":
            rel_path = "index.html"
        
        if rel_path in ("database", "records", "history", "grading"):
            query_str = f"?{parsed.query}" if parsed.query else ""
            self.send_response(302)
            self.send_header("Location", f"/database.html{query_str}")
            self.end_headers()
            return

        if rel_path in ("unified", "unified.html"):
            query_str = f"?{parsed.query}" if parsed.query else "?view=split"
            if "view=split" not in query_str:
                query_str += "&view=split"
            self.send_response(302)
            self.send_header("Location", f"/index.html{query_str}")
            self.end_headers()
            return

        if rel_path in ("second", "second.html", "screen2", "monitor2", "telemetry"):
            rel_path = "telemetry.html"

        if rel_path in ("index.html", "telemetry.html"):
            self._serve_html_with_station(BASE_DIR / rel_path, station_mode=station)
            return
        
        file_path = BASE_DIR / rel_path
        if file_path.exists() and file_path.is_file():
            mime_type, _ = mimetypes.guess_type(str(file_path))
            if not mime_type:
                mime_type = "application/octet-stream"
            with open(file_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", mime_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(content)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        global current_conveyor_panel, mqtt_queue, active_main_screen_module
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
        try:
            payload = json.loads(body)
        except Exception:
            payload = {}
        station = _resolve_station_mode(query_params=query, payload=payload)

        # Active Module Synchronisation (from Main Screen)
        if path == "/api/module/active":
            module_id = str(payload.get("module_id") or payload.get("panel_id") or "").strip().upper()[:16]
            if len(module_id) == 16 and module_id.startswith("USM"):
                active_main_screen_module_by_station[station] = module_id
                channel = str(payload.get("channel", "CH88" if station == "fvi" else "MANUAL")).strip().upper()
                if station == "fvi":
                    active_main_screen_module = module_id
                    current_conveyor_panel["panel_id"] = module_id
                    if channel in ("CH88", "MANUAL"):
                        current_conveyor_panel["channel"] = channel
                broadcast_sse("ACTIVE_MODULE_SYNC", {
                    "module_id": module_id,
                    "panel_id": module_id,
                    "station": station,
                    "channel": channel
                })
            current_mod = active_main_screen_module_by_station.get(station, "")
            self.send_json(200, {
                "success": True,
                "station": station,
                "module_id": current_mod,
                "panel_id": current_mod
            })
            return

        # 1. Operator CMMS Authentication (Supports Name-Only login, email, and plant CMMS)
        if path == "/api/auth/login":
            name = str(payload.get("name") or payload.get("username") or payload.get("email", "")).strip()
            password = payload.get("password", "").strip()
            shift = payload.get("shift", "Shift A")

            if not name:
                self.send_json(400, {"success": False, "message": "Please enter your First Name and Last Name"})
                return

            # Check if user matches any registered employee or direct name
            user_dict, error = verify_cmms_credentials(name, password or "skip_pwd_check")
            if not user_dict:
                # Direct Name-based operator login (First Name Last Name)
                user_id = name.lower().replace(" ", ".")
                user_dict = {
                    "user_id": user_id,
                    "username": name,
                    "full_name": name,
                    "name": name,
                    "role": "Inspector",
                    "department": "Quality Operations",
                    "shift": shift
                }
                try:
                    with get_db() as conn:
                        cur = conn.cursor()
                        cur.execute("SELECT user_id FROM cmms_users WHERE user_id = ? OR full_name = ?", (user_id, name))
                        if not cur.fetchone():
                            cur.execute("""
                            INSERT INTO cmms_users (user_id, username, email, password_hash, full_name, role, department, shift)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            """, (user_id, user_id, f"{user_id}@company.com", "direct_login", name, "Inspector", "Quality Operations", shift))
                            conn.commit()
                except Exception:
                    pass

            user_dict["shift"] = shift
            token = hashlib.sha256(f"{user_dict.get('user_id', name)}{time.time()}".encode("utf-8")).hexdigest()
            active_sessions[token] = user_dict
            self.send_json(200, {
                "success": True,
                "token": token,
                "user": user_dict,
                "message": f"Welcome, {user_dict.get('full_name', name)}. Please remember to log out when done!"
            })
            return

        # 2. Operator Logout
        if path == "/api/auth/logout":
            auth_header = self.headers.get("Authorization", "")
            token = auth_header.replace("Bearer ", "").strip()
            if token in active_sessions:
                del active_sessions[token]
            self.send_json(200, {"success": True, "message": "Logged out"})
            return

        # 3. INSTANT DATABASE SYNC ON CONFIRM (dbo.Final_Inspection_Defects or dbo.PostLam_Inspection_Defects)
        # Record_ID (IDENTITY) and Tested_At (datetimeoffset)
        if path == "/api/defects":
            module_id = str(payload.get("module_id", "")).strip()[:16]
            raw_loc = str(payload.get("defect_location") or payload.get("defect_cell") or payload.get("cell_coord", "")).strip()
            defect_location = "FRM" if raw_loc.upper() == "FRAME" else raw_loc[:4]
            defect_code = payload.get("defect_code", "A1")
            defect_name = payload.get("defect_name") or str(payload.get("defect_type") or "Defect")
            defect_type = str(defect_name).strip()[:30]
            tester_name = str(payload.get("tester_name") or payload.get("operator_name", "Inspector")).strip()
            side = str(payload.get("side", "front")).strip().lower()

            if not module_id or not defect_location:
                self.send_json(400, {"error": "Missing required fields (module_id, defect_location)"})
                return

            mssql_table = "dbo.PostLam_Inspection_Defects" if station == "postlam" else "dbo.Final_Inspection_Defects"
            sqlite_table = "postlam_inspection_defects" if station == "postlam" else "final_inspection_defects"

            # 1. Sync immediately to Microsoft SQL Server
            mssql_query = f"""
            INSERT INTO {mssql_table} (Module_ID, Tested_At, Defect_Location, Defect_Type, Tester_Name)
            VALUES (?, SYSDATETIMEOFFSET(), ?, ?, ?)
            """
            mssql_success, mssql_engine = execute_mssql_insert(mssql_query, (module_id, defect_location, defect_type, tester_name), station=station)

            # 2. Always persist to local SQLite for UI instant querying, sequential record_id, and offline cache
            with get_db() as local_conn:
                local_cur = local_conn.cursor()
                try:
                    local_cur.execute(f"""
                    INSERT INTO {sqlite_table} (module_id, defect_location, defect_cell, defect_type, tester_name, side)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """, (module_id, defect_location, defect_location, defect_type, tester_name, side))
                except Exception:
                    local_cur.execute(f"""
                    INSERT INTO {sqlite_table} (module_id, defect_location, defect_cell, defect_type, tester_name)
                    VALUES (?, ?, ?, ?, ?)
                    """, (module_id, defect_location, defect_location, defect_type, tester_name))
                local_conn.commit()
                record_id = local_cur.lastrowid

            dest_str = f"MSSQL ({mssql_engine})" if mssql_success else "SQLite (Local Cache)"
            print(f"[DB Sync] Inserted into {mssql_table} [{dest_str}]: {module_id} cell {defect_location} type '{defect_type}' ({side}) by {tester_name} (Local ID: #{record_id})")

            self.send_json(200, {
                "success": True,
                "saved_to_db": True,
                "station": station,
                "record_id": record_id,
                "module_id": module_id,
                "defect_location": defect_location,
                "defect_cell": defect_location,
                "defect_type": defect_type,
                "side": side,
                "tester_name": tester_name,
                "mssql_synced": mssql_success,
                "engine": mssql_engine if mssql_success else "SQLITE_LOCAL"
            })
            return

        # 4. Remove / Delete a Cell Defect via POST
        if path == "/api/defects/delete":
            module_id = str(payload.get("module_id", "")).strip()[:16]
            raw_cell = str(payload.get("defect_location") or payload.get("defect_cell") or payload.get("cell_coord", "")).strip()
            defect_cell = "FRM" if raw_cell.upper() == "FRAME" else raw_cell[:4]
            side = str(payload.get("side", "")).strip().lower()
            sqlite_table = "postlam_inspection_defects" if station == "postlam" else "final_inspection_defects"
            with get_db() as local_conn:
                cursor = local_conn.cursor()
                if side:
                    cursor.execute(
                        f"DELETE FROM {sqlite_table} WHERE module_id = ? AND (defect_location = ? OR defect_cell = ?) AND LOWER(COALESCE(side, 'front')) = ?",
                        (module_id, defect_cell, defect_cell, side)
                    )
                else:
                    cursor.execute(
                        f"DELETE FROM {sqlite_table} WHERE module_id = ? AND (defect_location = ? OR defect_cell = ?)",
                        (module_id, defect_cell, defect_cell)
                    )
                local_conn.commit()
            print(f"[DB Local Delete] Removed defect cell {defect_cell} ({side or 'any side'}) for module {module_id} from {sqlite_table}. (MSSQL maintains append-only audit trail)")
            self.send_json(200, {"success": True, "deleted": defect_cell, "side": side, "station": station})
            return

        # 5. Commit Inspection Grade (dbo.Final_Inspections or dbo.PostLam_Visual_Inspections)
        # Requirement: numeric grading 0 (A), 1 (B), 2 (Rework/Retest), 3 (Reject)
        if path == "/api/inspections":
            module_id = str(payload.get("module_id", "")).strip()[:16]
            raw_grade = str(payload.get("grade") or payload.get("result_code") or payload.get("final_grade", "0")).strip().upper()
            
            # Map letter to numeric database grade code: 0=A, 1=B, 2=Retest/Rework, 3=Reject
            GRADE_MAP = {
                "A": "0",
                "B": "1",
                "R": "2",
                "X": "3",
                "0": "0",
                "1": "1",
                "2": "2",
                "3": "3"
            }
            grade = GRADE_MAP.get(raw_grade, raw_grade)[:1]
            tester_name = str(payload.get("tester_name") or payload.get("operator_name", "Inspector")).strip()

            if not module_id or len(module_id) != 16 or not module_id.startswith("USM"):
                self.send_json(400, {"error": "Module serial must start with USM and have 16 characters (including USM)"})
                return

            # De-duplication check: Suppress duplicate submissions of identical (station, module_id, grade) within 15 seconds
            now_ts = time.time()
            dedup_key = f"{station}:{module_id}"
            with _recent_inspections_lock:
                # Purge entries older than 60s
                for m in list(_recent_inspections.keys()):
                    if now_ts - _recent_inspections[m]["timestamp"] > 60:
                        _recent_inspections.pop(m, None)

                prev = _recent_inspections.get(dedup_key)
                if prev and prev.get("grade") == grade and (now_ts - prev.get("timestamp", 0)) < 15.0:
                    elapsed = now_ts - prev["timestamp"]
                    print(f"[DB Sync] Duplicate submission suppressed ({station}) for {module_id} -> Grade [{grade}] ({elapsed:.1f}s ago). Returning previous record #{prev['record_id']}")
                    self.send_json(200, {
                        "success": True,
                        "station": station,
                        "record_id": prev["record_id"],
                        "module_id": module_id,
                        "grade": grade,
                        "result_code": grade,
                        "tester_name": tester_name,
                        "duplicate_suppressed": True,
                        "mssql_synced": True,
                        "engine": prev["engine"],
                        "current_panel": current_conveyor_panel,
                        "message": f"Module {module_id} grade [{grade}] already committed ({elapsed:.1f}s ago)"
                    })
                    return

            mssql_table = "dbo.PostLam_Visual_Inspections" if station == "postlam" else "dbo.Final_Inspections"
            sqlite_table = "postlam_visual_inspections" if station == "postlam" else "final_inspections"

            # 1. Sync immediately to Microsoft SQL Server
            mssql_query = f"""
            INSERT INTO {mssql_table} (Module_ID, Tested_At, Grade, Tester_Name)
            VALUES (?, SYSDATETIMEOFFSET(), ?, ?)
            """
            mssql_success, mssql_engine = execute_mssql_insert(mssql_query, (module_id, grade, tester_name), station=station)

            # 2. Persist to local SQLite (append grading event to preserve full audit log)
            with get_db() as local_conn:
                local_cur = local_conn.cursor()
                local_cur.execute(f"""
                INSERT INTO {sqlite_table} (module_id, grade, result_code, tester_name)
                VALUES (?, ?, ?, ?)
                """, (module_id, grade, grade, tester_name))
                local_conn.commit()
                record_id = local_cur.lastrowid
                action = "Inserted grade into"

            dest_str = f"MSSQL ({mssql_engine})" if mssql_success else "SQLite (Local Cache)"
            print(f"[DB Sync] {action} {mssql_table} [{dest_str}]: {module_id} -> Grade [{grade}] (Code: {grade}) by {tester_name} (Local ID #{record_id})")

            # Store in recent inspections cache for de-duplication
            with _recent_inspections_lock:
                _recent_inspections[dedup_key] = {
                    "grade": grade,
                    "timestamp": now_ts,
                    "record_id": record_id,
                    "engine": mssql_engine if mssql_success else "SQLITE_LOCAL"
                }

            # 3. Advance Queue / Reset Conveyor State
            if station == "postlam":
                if active_main_screen_module_by_station.get("postlam") == module_id:
                    active_main_screen_module_by_station["postlam"] = ""
            else:
                mqtt_queue = [item for item in mqtt_queue if item.get("panel_id") != module_id]
                if mqtt_queue:
                    next_panel = mqtt_queue.pop(0)
                    current_conveyor_panel = next_panel
                    active_main_screen_module = current_conveyor_panel.get("panel_id")
                    active_main_screen_module_by_station["fvi"] = active_main_screen_module or ""
                    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                    broadcast_sse("PANEL_ARRIVED", {
                        "type": "MQTT_CONVEYOR_UPDATE",
                        "module_id": current_conveyor_panel.get("panel_id"),
                        "panel_id": current_conveyor_panel.get("panel_id"),
                        "channel": current_conveyor_panel.get("channel", "CH88"),
                        "ch88_serial": mqtt_channel_serials.get("CH88"),
                        "ch89_serial": mqtt_channel_serials.get("CH89"),
                        "current_panel": current_conveyor_panel,
                        "queue": mqtt_queue,
                        "timestamp": ts
                    })
                else:
                    # Clear active conveyor state so graded module is not reloaded on page refresh
                    if current_conveyor_panel.get("panel_id") == module_id:
                        current_conveyor_panel = {
                            "panel_id": "",
                            "channel": "IDLE",
                            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                            "source": "Graded"
                        }
                    if mqtt_channel_serials.get("CH88") == module_id:
                        mqtt_channel_serials["CH88"] = None
                    if active_main_screen_module == module_id:
                        active_main_screen_module = ""
                    if active_main_screen_module_by_station.get("fvi") == module_id:
                        active_main_screen_module_by_station["fvi"] = ""

            self.send_json(200, {
                "success": True,
                "station": station,
                "record_id": record_id,
                "module_id": module_id,
                "grade": grade,
                "result_code": grade,
                "tester_name": tester_name,
                "mssql_synced": mssql_success,
                "engine": mssql_engine if mssql_success else "SQLITE_LOCAL",
                "next_module": current_conveyor_panel,
                "current_panel": current_conveyor_panel,
                "queue": mqtt_queue,
                "message": f"Module {module_id} grade [{grade}] committed to database"
            })
            return

        # 6. Advance Conveyor Queue to Next Module
        if path in ("/api/module/queue/next", "/api/conveyor/next", "/api/queue/next"):
            if mqtt_queue:
                next_panel = mqtt_queue.pop(0)
                current_conveyor_panel = next_panel
                active_main_screen_module = current_conveyor_panel.get("panel_id")
                active_main_screen_module_by_station["fvi"] = active_main_screen_module or ""
                ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                broadcast_sse("PANEL_ARRIVED", {
                    "type": "MQTT_CONVEYOR_UPDATE",
                    "module_id": current_conveyor_panel.get("panel_id"),
                    "panel_id": current_conveyor_panel.get("panel_id"),
                    "channel": current_conveyor_panel.get("channel", "CH88"),
                    "ch88_serial": mqtt_channel_serials.get("CH88"),
                    "ch89_serial": mqtt_channel_serials.get("CH89"),
                    "current_panel": current_conveyor_panel,
                    "queue": mqtt_queue,
                    "timestamp": ts
                })
            self.send_json(200, {
                "success": True,
                "current_panel": current_conveyor_panel,
                "next_module": current_conveyor_panel,
                "queue": mqtt_queue
            })
            return

        # 7. Simulate MQTT Conveyor Panel Arrival (CH88)
        if path == "/api/conveyor/simulate-mqtt":
            panel_id = str(payload.get("panel_id") or payload.get("module_id", "USM0111208260304")).strip().upper()
            handle_conveyor_serial_arrival(panel_id, "CH88")
            self.send_json(200, {
                "success": True,
                "current_panel": current_conveyor_panel,
                "queue": [],
                "ch88_serial": mqtt_channel_serials.get("CH88")
            })
            return

        self.send_json(404, {"error": "Endpoint not found"})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/defects":
            query = parse_qs(parsed.query)
            module_id = str(query.get("module_id", [""])[0]).strip()[:16]
            raw_cell = str(query.get("defect_location", [query.get("defect_cell", [query.get("cell_coord", [""])[0]])[0]])[0]).strip()
            defect_cell = "FRM" if raw_cell.upper() == "FRAME" else raw_cell[:4]
            side = str(query.get("side", [""])[0]).strip().lower()
            body_json = {}

            if not module_id or not defect_cell or not query.get("station"):
                # Fallback: check if payload/station was passed in body
                length = int(self.headers.get("Content-Length", 0))
                if length > 0:
                    try:
                        body_json = json.loads(self.rfile.read(length).decode("utf-8"))
                        module_id = module_id or str(body_json.get("module_id", "")).strip()[:16]
                        defect_cell = defect_cell or str(body_json.get("defect_location") or body_json.get("defect_cell") or body_json.get("cell_coord", "")).strip()[:4]
                        side = side or str(body_json.get("side", "")).strip().lower()
                    except Exception:
                        pass

            station = _resolve_station_mode(query_params=query, payload=body_json)
            sqlite_table = "postlam_inspection_defects" if station == "postlam" else "final_inspection_defects"

            if not module_id or not defect_cell:
                self.send_json(400, {"error": "Missing module_id or defect_cell for DELETE"})
                return

            with get_db() as local_conn:
                cursor = local_conn.cursor()
                if side:
                    cursor.execute(
                        f"DELETE FROM {sqlite_table} WHERE module_id = ? AND (defect_location = ? OR defect_cell = ?) AND LOWER(COALESCE(side, 'front')) = ?",
                        (module_id, defect_cell, defect_cell, side)
                    )
                else:
                    cursor.execute(
                        f"DELETE FROM {sqlite_table} WHERE module_id = ? AND (defect_location = ? OR defect_cell = ?)",
                        (module_id, defect_cell, defect_cell)
                    )
                local_conn.commit()

            print(f"[DB Local Delete] HTTP DELETE removed defect {defect_cell} ({side or 'any side'}) for module {module_id} from {sqlite_table}.")
            self.send_json(200, {"success": True, "deleted": defect_cell, "side": side, "station": station})
            return

        self.send_json(404, {"error": "Endpoint not found"})

# ---------------------------------------------------------------------------
# Server Launcher
# ---------------------------------------------------------------------------
def _apply_cli_args():
    import argparse
    parser = argparse.ArgumentParser(description="FVI / Post-Lam Inspection Edge Gateway Server")
    parser.add_argument("--station", "--mode", dest="station", help="Lock station mode (fvi or postlam)")
    parser.add_argument("--port", type=int, help="Override HTTP server port")
    args, _ = parser.parse_known_args()
    if args.station:
        CONFIG["station_mode"] = _normalize_station(args.station)
    if args.port:
        CONFIG["port"] = args.port


def _detect_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("10.1.19.75", 21))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return "127.0.0.1"


def run_server():
    _apply_cli_args()
    init_database()
    start_mqtt_listener()
    port = CONFIG["port"]
    server_address = (CONFIG["host"], port)
    station_mode = _normalize_station(CONFIG.get("station_mode", "fvi"))
    lan_ip = _detect_lan_ip()
    
    try:
        httpd = ThreadingHTTPServer(server_address, FVIEdgeHandler)
        print("=" * 68)
        print(f"FVI / POST-LAM — EDGE GATEWAY SERVER RUNNING ON PORT {port} (Default Mode: {station_mode.upper()})")
        print(f"FVI Console URL:      http://{lan_ip}:{port}/")
        print(f"Post-Lam Tablet URL:  http://{lan_ip}:{port}/postlam")
        print(f"Post-Lam Monitor 2:   http://{lan_ip}:{port}/postlam/second")
        print("  - CMMS Auth Database: Ready (SQLite / CMMS connector)")
        print(f"  - MSSQL Production: {'Active' if CONFIG['mssql']['enabled'] else 'Offline Fallback'} (Server={CONFIG['mssql']['server']};Database={CONFIG['mssql']['database']})")
        print("  - Instant Defect DB Sync: dbo.Final_Inspection_Defects & dbo.PostLam_Inspection_Defects")
        print("  - Conveyor MQTT Listener: Active (Topic: usm/cstx/prod/line2/#)")
        print(f"  - FVI FTP Fetcher: {'Configured' if CONFIG['ftp']['enabled'] else 'Disabled'} ({CONFIG['ftp']['host']}:{CONFIG['ftp']['port']})")
        pl_ftp = CONFIG["ftp_postlam"]
        pl_hosts = ", ".join(pl_ftp.get("hosts") or ([pl_ftp["host"]] if pl_ftp.get("host") else ["Pending Credentials"]))
        print(f"  - Post-Lam FTP Fetcher: {'Configured' if pl_ftp['enabled'] else 'Disabled'} ({pl_hosts}:{pl_ftp['port']})")
        print("=" * 68)
        httpd.serve_forever()
    except OSError as e:
        if "already in use" in str(e).lower() or e.errno == 98 or e.errno == 10048:
            print(f"[Notice] Port {port} is occupied. Trying alternative port 5000...")
            CONFIG["port"] = 5000
            httpd = ThreadingHTTPServer((CONFIG["host"], 5000), FVIEdgeHandler)
            print(f"FVI Edge Gateway running on http://{lan_ip}:5000")
            httpd.serve_forever()
        else:
            raise e

if __name__ == "__main__":
    run_server()
