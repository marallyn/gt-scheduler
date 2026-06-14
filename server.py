#!/usr/bin/env python3
import http.server
import socketserver
import urllib.parse
import json
import subprocess
import os
import sys

PORT = 8085

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self):
        # Parse the URL path and query parameters
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query_params = urllib.parse.parse_qs(parsed_url.query)
        
        # Ignore noisy browser/tooling requests to keep logs clean
        if path in ("/favicon.ico", "/.well-known/appspecific/com.chrometools.json"):
            self.send_response(204)
            self.end_headers()
            return
            
        # Check if this is our API endpoint
        if path == "/api/fetch-subject":
            subject = query_params.get("subject", [None])[0]
            if not subject:
                self.send_error_response(400, "Subject parameter is required.")
                return
                
            subject = subject.lower().strip()
            # Validate subject to prevent command injection
            if not subject.isalnum() or len(subject) > 10:
                self.send_error_response(400, "Invalid subject code.")
                return
                
            try:
                # Run the update_courses.py script
                script_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "update_courses.py")
                print(f"Running updater script for subject: {subject.upper()}...")
                
                result = subprocess.run(
                    [sys.executable, script_path, "--subject", subject],
                    capture_output=True,
                    text=True,
                    check=True
                )
                
                # Try to parse JSON_STATS from stdout
                stats = None
                if result.stdout:
                    for line in result.stdout.split('\n'):
                        if line.startswith("JSON_STATS:"):
                            try:
                                stats = json.loads(line[len("JSON_STATS:"):].strip())
                            except Exception as parse_err:
                                print(f"Error parsing JSON_STATS: {parse_err}")
                            break

                # Send success response
                self.send_success_response({
                    "success": True,
                    "message": f"Successfully updated subject '{subject.upper()}'.",
                    "stats": stats,
                    "stdout": result.stdout,
                    "stderr": result.stderr
                })
            except subprocess.CalledProcessError as e:
                print(f"Script failed with exit code {e.returncode}: {e.stderr or e.stdout}")
                self.send_error_response(500, f"Script failed: {e.stderr or e.stdout or str(e)}")
            except Exception as e:
                print(f"Error executing script: {str(e)}")
            return
            
        elif path == "/api/profiles":
            try:
                profiles_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "profiles.json")
                profiles = {}
                if os.path.exists(profiles_path):
                    with open(profiles_path, "r", encoding="utf-8") as f:
                        profiles = json.load(f)
                self.send_success_response({"success": True, "profiles": profiles})
            except Exception as e:
                self.send_error_response(500, f"Error reading profiles: {str(e)}")
            return
            
        # Fall back to standard static file serving
        super().do_GET()

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        
        if path == "/api/save-profile":
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                profile_name = data.get("name")
                if not profile_name:
                    self.send_error_response(400, "Profile name is required.")
                    return
                    
                profiles_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "profiles.json")
                profiles = {}
                if os.path.exists(profiles_path):
                    with open(profiles_path, "r", encoding="utf-8") as f:
                        try:
                            profiles = json.load(f)
                        except Exception:
                            profiles = {}
                            
                profiles[profile_name] = data
                
                with open(profiles_path, "w", encoding="utf-8") as f:
                    json.dump(profiles, f, indent=2)
                    
                self.send_success_response({"success": True, "message": f"Profile '{profile_name}' saved successfully."})
            except Exception as e:
                self.send_error_response(500, f"Error saving profile: {str(e)}")
            return
            
        elif path == "/api/delete-profile":
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                profile_name = data.get("name")
                if not profile_name:
                    self.send_error_response(400, "Profile name is required.")
                    return
                    
                profiles_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "profiles.json")
                if os.path.exists(profiles_path):
                    with open(profiles_path, "r", encoding="utf-8") as f:
                        try:
                            profiles = json.load(f)
                        except Exception:
                            profiles = {}
                    if profile_name in profiles:
                        del profiles[profile_name]
                        with open(profiles_path, "w", encoding="utf-8") as f:
                            json.dump(profiles, f, indent=2)
                        self.send_success_response({"success": True, "message": f"Profile '{profile_name}' deleted."})
                        return
                self.send_error_response(404, f"Profile '{profile_name}' not found.")
            except Exception as e:
                self.send_error_response(500, f"Error deleting profile: {str(e)}")
            return
            
        self.send_error_response(404, "Endpoint not found.")

    def send_success_response(self, data):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def send_error_response(self, code, message):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps({
            "success": False,
            "error": message
        }).encode("utf-8"))

def main():
    port = PORT
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
            
    # Set CWD to the directory containing server.py
    server_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(server_dir)
    
    # Allow port reuse
    socketserver.TCPServer.allow_reuse_address = True
    
    with socketserver.TCPServer(("", port), CustomHandler) as httpd:
        print(f"Custom GT Scheduler server running at http://localhost:{port}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")

if __name__ == "__main__":
    main()
