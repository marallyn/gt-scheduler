#!/usr/bin/env python3
"""
Georgia Tech Major Requirements Extractor Tool
Scrapes catalog.gatech.edu/programs/ to discover BS major degree requirements
and generate MAJOR_DATA JSON structures for gt-scheduler.
"""

import urllib.request
import ssl
import re
import json
import argparse
import sys
import os

CATALOG_PROGRAMS_URL = "https://catalog.gatech.edu/programs/"

def get_ssl_context():
    ctx = ssl._create_unverified_context()
    return ctx

def discover_bs_programs():
    print(f"Discovering undergraduate B.S. degree programs from {CATALOG_PROGRAMS_URL}...")
    req = urllib.request.Request(
        CATALOG_PROGRAMS_URL,
        headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    )
    try:
        with urllib.request.urlopen(req, context=get_ssl_context()) as resp:
            html = resp.read().decode('utf-8')
        links = re.findall(r'href="/programs/([a-z0-9-]+-bs[a-z0-9-]*)/"', html)
        programs = sorted(list(set(links)))
        print(f"Discovered {len(programs)} B.S. degree program URLs.")
        return programs
    except Exception as e:
        print(f"Error discovering programs: {e}", file=sys.stderr)
        return []

def clean_major_title(title):
    if not title:
        return ""
    import html as html_lib
    title = html_lib.unescape(title)
    title = re.sub(r'&#\d+;', '', title)
    title = title.replace('\xa0', ' ').replace('&nbsp;', ' ')
    
    # Strip "Bachelor of Science in " or "Bachelor of Science"
    title = re.sub(r'^Bachelor\s+of\s+Science\s+in\s+', '', title, flags=re.IGNORECASE)
    title = re.sub(r'^Bachelor\s+of\s+Science\s+', '', title, flags=re.IGNORECASE)
    title = re.sub(r'\s*\(B\.S\.\)$', '', title, flags=re.IGNORECASE)
    
    # Strip "Thread:" or "- Thread:"
    title = re.sub(r'-\s*Thread:\s*', '- ', title, flags=re.IGNORECASE)
    title = re.sub(r'Thread:\s*', '', title, flags=re.IGNORECASE)
    
    title = re.sub(r'\s+', ' ', title).strip()
    return title

def scrape_program_requirements(program_slug):
    url = f"https://catalog.gatech.edu/programs/{program_slug}/"
    print(f"Fetching requirements for '{program_slug}' from {url}...")
    req = urllib.request.Request(
        url,
        headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    )
    try:
        with urllib.request.urlopen(req, context=get_ssl_context()) as resp:
            html = resp.read().decode('utf-8')
    except Exception as e:
        print(f"Error fetching {url}: {e}", file=sys.stderr)
        return None

    # Title extraction
    title_match = re.search(r'<h1[^>]*>(.*?)</h1>', html, re.DOTALL)
    title = program_slug.replace('-', ' ').title()
    if title_match:
        raw_title = re.sub(r'<[^>]+>', '', title_match.group(1)).strip()
        if raw_title:
            title = raw_title
            
    title = clean_major_title(title)

    # Extract sc_courselist tables
    categories = {}
    current_category = "General Core"
    categories[current_category] = []

    course_rows = re.findall(r'<tr[^>]*class="([^"]*)"[^>]*>(.*?)</tr>', html, re.DOTALL)
    
    total_hours = 120

    for tr_class, tr_content in course_rows:
        if "areaheader" in tr_class:
            cat_match = re.search(r'<span[^>]*class="courselistcomment areaheader[^"]*"[^>]*>(.*?)</span>', tr_content, re.DOTALL)
            if cat_match:
                cat_name = re.sub(r'<[^>]+>', '', cat_match.group(1)).strip()
                if cat_name:
                    current_category = cat_name
                    if current_category not in categories:
                        categories[current_category] = []
        else:
            code_match = re.search(r'<td class="codecol"[^>]*>.*?title="([^"]+)"', tr_content, re.DOTALL)
            if not code_match:
                code_match = re.search(r'<a[^>]*class="code"[^>]*>([^<]+)</a>', tr_content, re.DOTALL)
            
            if code_match:
                code_text = code_match.group(1).replace('\xa0', ' ').strip()
                if code_text and code_text not in categories[current_category]:
                    categories[current_category].append(code_text)

    # Clean up empty categories
    cleaned_categories = {k: v for k, v in categories.items() if len(v) > 0}

    suggested = generate_suggested_semesters(cleaned_categories)

    return {
        "name": title,
        "url": url,
        "target_hours": total_hours,
        "requirements": cleaned_categories,
        "suggested_semesters": suggested
    }

def get_course_level(code):
    if "GT 1000" in code or "APPH" in code or "WELLNESS" in code or "ENGL 1101" in code:
        return 10
    if "ENGL 1102" in code or "MATH 1551" in code or "CHEM 1211" in code:
        return 12
    if "MATH 1552" in code or "CS 1301" in code or "CS 1371" in code:
        return 15
    m = re.search(r'\b([1-4])\d{3}\b', code)
    if m:
        return int(m.group(1)) * 10
    if "ELECTIVE" in code or "BREADTH" in code or "DEPTH" in code:
        return 35
    return 25

def generate_suggested_semesters(categories):
    items = []
    seen = set()
    
    # Core & foundational categories first
    core_cats = ["Wellness Requirement", "Institutional Priority", "Communicating in Writing", 
                 "Mathematics and Quantitative Skills", "Political Science and U.S. History", 
                 "Technology, Mathematics, and Sciences", "General Core", "Field of Study", 
                 "Major Requirements", "Core Biology", "Core Neuroscience", "Core BME"]
    
    for cat in core_cats:
        if cat in categories:
            for item in categories[cat]:
                if item not in seen:
                    seen.add(item)
                    items.append(item)
                    
    for cat, item_list in categories.items():
        for item in item_list:
            if item not in seen:
                seen.add(item)
                items.append(item)

    sorted_items = sorted(items, key=get_course_level)

    active_sems = ["Fall 2026", "Spring 2027", "Fall 2027", "Spring 2028", "Fall 2028", "Spring 2029", "Fall 2029", "Spring 2030"]
    semesters = {"Summer 2026": []}
    for sem in active_sems:
        semesters[sem] = []

    if len(sorted_items) > 0:
        chunk_size = max(1, (len(sorted_items) + len(active_sems) - 1) // len(active_sems))
        for i, item in enumerate(sorted_items):
            sem_idx = min(i // chunk_size, len(active_sems) - 1)
            semesters[active_sems[sem_idx]].append(item)

    return semesters

def save_major_data(majors_dict):
    data_js_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.js")
    if not os.path.exists(data_js_path):
        print(f"Error: {data_js_path} not found.")
        return False

    with open(data_js_path, "r", encoding="utf-8") as f:
        content = f.read()

    idx = content.find("const MAJOR_DATA = {")
    if idx == -1:
        print("Error: Could not find MAJOR_DATA in data.js")
        return False

    header = content[:idx]
    
    # Existing MAJOR_DATA JS string replacement or merge
    # Parse existing MAJOR_DATA if possible or replace block
    # Simple JS object formatter for MAJOR_DATA
    major_data_obj = {"gt": majors_dict}
    major_data_json = json.dumps(major_data_obj, indent=2)
    new_major_data_js = f"const MAJOR_DATA = {major_data_json};\n"

    full_content = header + new_major_data_js
    with open(data_js_path, "w", encoding="utf-8") as f:
        f.write(full_content)

    public_data_js = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public", "data.js")
    if os.path.exists(os.path.dirname(public_data_js)):
        with open(public_data_js, "w", encoding="utf-8") as f:
            f.write(full_content)

    print(f"Saved {len(majors_dict)} majors to data.js and public/data.js!")
    return True

def load_existing_majors():
    data_js_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.js")
    if not os.path.exists(data_js_path):
        return {}

    with open(data_js_path, "r", encoding="utf-8") as f:
        content = f.read()

    idx = content.find("const MAJOR_DATA = {")
    if idx == -1:
        return {}

    js_part = content[idx + len("const MAJOR_DATA = "):].strip()
    if js_part.endswith(";"):
        js_part = js_part[:-1].strip()

    try:
        data = json.loads(js_part)
        return data.get("gt", {})
    except Exception:
        return {}

def main():
    parser = argparse.ArgumentParser(description="Georgia Tech Major Requirements Extractor")
    parser.add_argument("--discover", action="store_true", help="List all discovered B.S. program URLs")
    parser.add_argument("--program", help="Scrape requirements for a specific program slug (e.g. computer-science-bs)")
    parser.add_argument("--save", action="store_true", help="Save scraped program requirements into data.js")
    parser.add_argument("--all", action="store_true", help="Scrape all discovered B.S. programs and update data.js")
    args = parser.parse_args()

    existing_majors = load_existing_majors()

    if args.discover:
        progs = discover_bs_programs()
        for p in progs:
            print(f" - {p}")
    elif args.program:
        data = scrape_program_requirements(args.program)
        if data:
            print(json.dumps(data, indent=2))
            if args.save:
                key = args.program.replace('-', '_').replace('_bs', '')
                existing_majors[key] = data
                save_major_data(existing_majors)
    elif args.all:
        progs = discover_bs_programs()
        print(f"Scraping all {len(progs)} major programs...")
        for p in progs:
            data = scrape_program_requirements(p)
            if data and data.get("requirements"):
                key = p.replace('-', '_').replace('_bs', '')
                existing_majors[key] = data
        save_major_data(existing_majors)

if __name__ == "__main__":
    main()
