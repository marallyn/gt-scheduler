#!/usr/bin/env python3
import urllib.request
import re
import json
import os
import argparse
import sys

DATA_JS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.js")

def fetch_subject_courses(subject_code):
    subject_code = subject_code.lower().strip()
    url = f"https://catalog.gatech.edu/coursesaz/{subject_code}/"
    print(f"Fetching courses from {url}...")
    
    try:
        import ssl
        ctx = ssl._create_unverified_context()
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        with urllib.request.urlopen(req, context=ctx) as response:
            html = response.read().decode('utf-8')
    except Exception as e:
        print(f"Error fetching subject {subject_code}: {e}", file=sys.stderr)
        return None
        
    course_blocks = re.findall(r'<div class="courseblock">(.*?)</div>', html, re.DOTALL)
    print(f"Found {len(course_blocks)} course blocks for {subject_code.upper()}")
    
    courses = {}
    for block in course_blocks:
        title_match = re.search(r'<p class="courseblocktitle"><strong>(.*?)</strong></p>', block, re.DOTALL)
        desc_match = re.search(r'<p class="courseblockdesc">\s*(.*?)\s*</p>', block, re.DOTALL)
        
        if title_match:
            title_text = title_match.group(1).strip()
            # Strip tags and normalize spaces
            title_text = re.sub(r'<[^>]+>', '', title_text)
            title_text = title_text.replace('&nbsp;', ' ').replace('\xa0', ' ')
            
            parts = re.split(r'\.\s+', title_text)
            if len(parts) >= 3:
                code = parts[0].strip()
                name = parts[1].strip()
                hours_text = parts[2].strip()
                
                hours = 3
                hours_num_match = re.search(r'(\d+)(?:-\d+)?\s+Credit', hours_text)
                if hours_num_match:
                    hours = int(hours_num_match.group(1))
                
                desc = ""
                if desc_match:
                    desc = desc_match.group(1).strip()
                    desc = re.sub(r'<[^>]+>', '', desc)
                    desc = desc.replace('&nbsp;', ' ').replace('\xa0', ' ').replace('\n', ' ')
                    desc = re.sub(r'\s+', ' ', desc)
                    desc = desc.replace('<br/>', '').strip()
                
                courses[code] = {
                    "name": name,
                    "hours": hours,
                    "description": desc
                }
                
    return courses

def load_existing_db():
    if not os.path.exists(DATA_JS_PATH):
        print(f"Error: {DATA_JS_PATH} not found.")
        return {}
        
    with open(DATA_JS_PATH, "r", encoding="utf-8") as f:
        content = f.read()
        
    db_start_idx = content.find("const COURSES_DB = {")
    if db_start_idx == -1:
        print("Error: Could not find COURSES_DB in data.js")
        return {}
        
    lines = content.split('\n')
    in_db = False
    db_lines = []
    for line in lines:
        if "const COURSES_DB = {" in line:
            in_db = True
            continue
        if in_db and "};" in line:
            in_db = False
            break
        if in_db:
            db_lines.append(line)
            
    existing_db = {}
    for line in db_lines:
        line = line.strip()
        if not line or line.startswith("//"):
            continue
        m = re.match(r'"([^"]+)":\s*(\{.*\})', line)
        if m:
            key = m.group(1)
            val_str = m.group(2)
            if val_str.endswith(","):
                val_str = val_str[:-1]
            try:
                val = json.loads(val_str)
                existing_db[key] = val
            except:
                # Attempt to clean keys in javascript object
                val_str = re.sub(r'(\w+):', r'"\1":', val_str)
                try:
                    val = json.loads(val_str)
                    existing_db[key] = val
                except:
                    pass
    return existing_db

def save_db(db):
    if not os.path.exists(DATA_JS_PATH):
        print(f"Error: {DATA_JS_PATH} not found.")
        return False
        
    with open(DATA_JS_PATH, "r", encoding="utf-8") as f:
        content = f.read()
        
    db_start_idx = content.find("const COURSES_DB = {")
    major_data_idx = content.find("const MAJOR_DATA = {")
    
    if db_start_idx == -1 or major_data_idx == -1:
        print("Error: data.js file has invalid structure.")
        return False
        
    db_js_lines = ["const COURSES_DB = {"]
    keys = sorted(db.keys())
    for i, k in enumerate(keys):
        v = db[k]
        val_str = json.dumps(v)
        comma = "," if i < len(keys) - 1 else ""
        db_js_lines.append(f'  "{k}": {val_str}{comma}')
    db_js_lines.append("};")
    new_db_js = "\n".join(db_js_lines)
    
    header = content[:db_start_idx]
    footer = content[major_data_idx:]
    
    with open(DATA_JS_PATH, "w", encoding="utf-8") as f:
        f.write(header + new_db_js + "\n\n" + footer)
        
    print(f"Saved {len(db)} courses to data.js successfully!")
    return True

def main():
    parser = argparse.ArgumentParser(description="Georgia Tech Catalog Course Extractor Tool")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--subject", help="Fetch and merge all courses for a subject code (e.g. math, chem, phys)")
    group.add_argument("--course", help="Fetch and merge details for a specific course code (e.g. MATH 1551)")
    group.add_argument("--all-required", action="store_true", help="Fetch and merge all default major subjects (bios, bme, neur, psyc, math, chem, phys)")
    
    args = parser.parse_args()
    
    existing_db = load_existing_db()
    print(f"Loaded {len(existing_db)} existing courses from database.")
    
    if args.subject:
        subject_upper = args.subject.upper().strip()
        new_courses = fetch_subject_courses(args.subject)
        
        if new_courses is None:
            print(f"Error: Failed to fetch catalog page for subject {subject_upper}.", file=sys.stderr)
            sys.exit(1)
            
        if len(new_courses) == 0:
            print(f"Error: No courses found in catalog for subject {subject_upper}. This might be an invalid subject code or the catalog layout has changed.", file=sys.stderr)
            sys.exit(1)
            
        # Find all courses currently in database for this subject
        existing_subject_keys = [k for k in existing_db if k.split() and k.split()[0].upper() == subject_upper]
        
        added = 0
        updated = 0
        deleted = 0
        
        # 1. Update existing courses and add new ones
        for code, info in new_courses.items():
            if code not in existing_db:
                added += 1
                existing_db[code] = info
            else:
                existing_info = existing_db[code]
                if (existing_info.get("name") != info["name"] or 
                    existing_info.get("hours") != info["hours"] or 
                    existing_info.get("description") != info["description"]):
                    updated += 1
                    existing_db[code] = info
        
        # 2. Delete existing courses that are not in the fetched catalog
        for code in existing_subject_keys:
            if code not in new_courses:
                deleted += 1
                del existing_db[code]
                
        save_db(existing_db)
        
        # Print structured stats for server.py to parse
        stats = {
            "fetched": len(new_courses),
            "added": added,
            "updated": updated,
            "deleted": deleted
        }
        print(f"JSON_STATS: {json.dumps(stats)}")
            
    elif args.course:
        # Resolve subject from course code (e.g., "MATH 1551" -> "MATH")
        course_code = args.course.upper().strip()
        m = re.match(r'^([A-Z]+)\s*(\d+[A-Z]*)$', course_code)
        if not m:
            print("Error: Course code must be in the format 'SUBJECT NUMBER' (e.g. 'MATH 1551')")
            sys.exit(1)
            
        subj = m.group(1).lower()
        new_courses = fetch_subject_courses(subj)
        if new_courses:
            # Check if specific course exists
            if course_code in new_courses:
                existing_db[course_code] = new_courses[course_code]
                save_db(existing_db)
                print(f"Successfully updated specific course {course_code}!")
            else:
                # Try with non-breaking space
                nbsp_code = course_code.replace(" ", "\xa0")
                if nbsp_code in new_courses:
                    existing_db[course_code] = new_courses[nbsp_code]
                    save_db(existing_db)
                    print(f"Successfully updated specific course {course_code}!")
                else:
                    print(f"Error: Course {course_code} not found on the subject page.")
                    
    elif args.all_required:
        required_subjects = ["bios", "bme", "neur", "psyc", "math", "chem", "phys"]
        for subj in required_subjects:
            new_courses = fetch_subject_courses(subj)
            if new_courses:
                existing_db.update(new_courses)
        save_db(existing_db)

if __name__ == "__main__":
    main()
