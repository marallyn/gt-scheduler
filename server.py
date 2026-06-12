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
    def do_GET(self):
        # Parse the URL path and query parameters
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query_params = urllib.parse.parse_qs(parsed_url.query)
        
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
                
                # Send success response
                self.send_success_response({
                    "success": True,
                    "message": f"Successfully updated subject '{subject.upper()}'.",
                    "stdout": result.stdout,
                    "stderr": result.stderr
                })
            except subprocess.CalledProcessError as e:
                print(f"Script failed with exit code {e.returncode}: {e.stderr or e.stdout}")
                self.send_error_response(500, f"Script failed: {e.stderr or e.stdout or str(e)}")
            except Exception as e:
                print(f"Error executing script: {str(e)}")
                self.send_error_response(500, f"Error: {str(e)}")
            return
            
        # Fall back to standard static file serving
        super().do_GET()

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
