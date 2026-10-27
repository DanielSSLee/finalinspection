#!/usr/bin/env python3
"""
Quick Database Inspector for FVI Station Tables
Usage: python view_db.py
"""
import sqlite3
from pathlib import Path

DB_FILE = Path(__file__).resolve().parent / "fvi_production.db"

def inspect():
    if not DB_FILE.exists():
        print(f"Database file not found: {DB_FILE}")
        return

    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()

    print("=" * 80)
    print(" 1. TABLE: final_inspections (Single Grade per Module)")
    print("=" * 80)
    c.execute("SELECT record_id, module_id, COALESCE(grade, result_code), tested_at, tester_name FROM final_inspections ORDER BY record_id DESC")
    inspections = c.fetchall()
    if not inspections:
        print("  (No inspections committed yet)")
    else:
        print(f"  {'RECORD_ID':<10} | {'MODULE_ID':<18} | {'GRADE':<6} | {'TESTED_AT':<20} | {'TESTER'}")
        print("  " + "-" * 76)
        for r in inspections:
            print(f"  #{r[0]:<9} | {r[1]:<18} | [{r[2]}]    | {str(r[3]):<20} | {r[4]}")

    print("\n" + "=" * 80)
    print(" 2. TABLE: final_inspection_defects (Defects Logged)")
    print("=" * 80)
    c.execute("SELECT record_id, module_id, COALESCE(defect_location, defect_cell), defect_type, tested_at, tester_name FROM final_inspection_defects ORDER BY record_id DESC LIMIT 20")
    defects = c.fetchall()
    if not defects:
        print("  (No defects logged yet)")
    else:
        print(f"  {'RECORD_ID':<10} | {'MODULE_ID':<18} | {'CELL':<6} | {'TYPE':<28} | {'TESTED_AT':<20} | {'TESTER'}")
        print("  " + "-" * 98)
        for r in defects:
            print(f"  #{r[0]:<9} | {r[1]:<18} | {str(r[2]):<6} | {str(r[3]):<28} | {str(r[4]):<20} | {r[5]}")

    print("=" * 80)
    conn.close()

if __name__ == "__main__":
    inspect()
