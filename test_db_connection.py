import os
import sys
import socket
import time
from pathlib import Path

# Load .env if present
env_file = Path(__file__).resolve().parent / ".env"
if env_file.exists():
    try:
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k not in os.environ:
                        os.environ[k] = v
    except Exception:
        pass

DB_HOST = os.environ.get("MSSQL_SERVER", "localhost")
DB_PORT = int(os.environ.get("MSSQL_PORT", "1433"))
DB_NAME = os.environ.get("MSSQL_DATABASE", "PL2")
DB_USER = os.environ.get("MSSQL_USER", "Final_Inspection")
DB_PASS = os.environ.get("MSSQL_PASSWORD", "")

def test_tcp_reachability(host, port, timeout=4.0):
    print(f"[*] Step 1: Testing TCP Socket Reachability to {host}:{port} (timeout={timeout}s)...")
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    start = time.time()
    try:
        sock.connect((host, port))
        elapsed = (time.time() - start) * 1000
        print(f"    [+] TCP connection SUCCESSFUL in {elapsed:.1f}ms! Port {port} is open and accessible.")
        sock.close()
        return True
    except socket.timeout:
        print(f"    [-] TCP connection TIMED OUT after {timeout}s.")
        print(f"        Diagnosis: Packets to {host}:{port} are being dropped or blocked.")
        return False
    except ConnectionRefusedError:
        print(f"    [-] TCP connection REFUSED by {host}:{port}.")
        print(f"        Diagnosis: Host is reachable, but SQL Server is not running or not listening on port {port}.")
        return False
    except Exception as e:
        print(f"    [-] TCP connection failed: {type(e).__name__} - {e}")
        return False
    finally:
        sock.close()

def test_mssql_connection():
    print(f"\n[*] Step 2: Testing Microsoft SQL Server Authentication & Connection...")
    conn = None
    engine = None

    # Try pyodbc first
    try:
        import pyodbc
        for driver in ["ODBC Driver 17 for SQL Server", "ODBC Driver 18 for SQL Server", "SQL Server"]:
            try:
                conn_str = f"DRIVER={{{driver}}};SERVER={DB_HOST},{DB_PORT};DATABASE={DB_NAME};UID={DB_USER};PWD={DB_PASS};TrustServerCertificate=yes;Timeout=5;"
                conn = pyodbc.connect(conn_str, timeout=5)
                engine = f"pyodbc ({driver})"
                print(f"    [+] Connected via {engine}!")
                break
            except Exception:
                continue
    except ImportError:
        pass

    # Fallback to pymssql
    if not conn:
        try:
            import pymssql
            conn = pymssql.connect(
                server=DB_HOST,
                port=DB_PORT,
                user=DB_USER,
                password=DB_PASS,
                database=DB_NAME,
                timeout=5
            )
            engine = "pymssql"
            print(f"    [+] Connected via {engine}!")
        except Exception as e:
            print(f"    [-] pymssql connection failed: {e}")

    if not conn:
        print("    [-] Could not establish SQL Server connection with any available driver.")
        return False

    try:
        cur = conn.cursor()

        # Step 3: Inspect Tables and Schema
        print(f"\n[*] Step 3: Inspecting Schema of Production Tables in database '{DB_NAME}'...")
        for table in ["Final_Inspections", "Final_Inspection_Defects"]:
            print(f"\n  -- Table: dbo.{table} --")
            cur.execute(f"""
                SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = '{table}'
                ORDER BY ORDINAL_POSITION
            """)
            cols = cur.fetchall()
            for col in cols:
                name, dt, max_len, nullable = col[0], col[1], col[2], col[3]
                len_str = f"({max_len})" if max_len and max_len > 0 else ("(max)" if max_len == -1 else "")
                null_str = "NULL" if nullable == "YES" else "NOT NULL"
                print(f"     * {name:<18} {dt}{len_str:<8} {null_str}")

        # Step 4: Check User Permissions
        print(f"\n[*] Step 4: Checking Permissions for user '{DB_USER}'...")
        for table in ["dbo.Final_Inspections", "dbo.Final_Inspection_Defects"]:
            cur.execute(f"SELECT permission_name FROM fn_my_permissions('{table}', 'OBJECT')")
            perms = [r[0] for r in cur.fetchall()]
            print(f"    [+] {table}: {perms}")

        # Step 5: Test INSERT in transaction (with immediate rollback)
        print(f"\n[*] Step 5: Validating Live INSERT Capability (Transaction will be cleanly rolled back)...")
        placeholder = "%s" if engine == "pymssql" else "?"
        
        # Insert test defect
        cur.execute(f"""
            INSERT INTO dbo.Final_Inspection_Defects (Module_ID, Tested_At, Defect_Location, Defect_Type, Tester_Name)
            VALUES ({placeholder}, SYSDATETIMEOFFSET(), {placeholder}, {placeholder}, {placeholder})
        """, ("DIAG_TEST_MOD_01", "C8", "Micro-Crack (Hairline)", "DiagTool"))
        print("    [+] INSERT into dbo.Final_Inspection_Defects: OK!")

        # Insert test inspection grade
        cur.execute(f"""
            INSERT INTO dbo.Final_Inspections (Module_ID, Tested_At, Grade, Tester_Name)
            VALUES ({placeholder}, SYSDATETIMEOFFSET(), {placeholder}, {placeholder})
        """, ("DIAG_TEST_MOD_01", "A", "DiagTool"))
        print("    [+] INSERT into dbo.Final_Inspections: OK!")

        # Roll back cleanly so database remains untouched
        conn.rollback()
        print("    [+] Transaction rolled back successfully (no test data persisted).")

        conn.close()
        print(f"\n[SUCCESS] Final Inspection SQL Server PL2 is 100% ONLINE & FULLY OPERATIONAL!")
        return True
    except Exception as e:
        print(f"    [-] Verification error: {e}")
        try:
            conn.rollback()
            conn.close()
        except Exception:
            pass
        return False

if __name__ == "__main__":
    print("=" * 70)
    print(" US Modules — Final Inspection SQL Server (PL2) Connection Test")
    print(f" Target: Server={DB_HOST}:{DB_PORT}; Database={DB_NAME}; User Id={DB_USER}")
    print("=" * 70)
    reachable = test_tcp_reachability(DB_HOST, DB_PORT)
    if reachable:
        test_mssql_connection()
    else:
        print(f"\n[!] Cannot reach {DB_HOST}:{DB_PORT}. Check network/firewall connection.")
    print("=" * 70)
