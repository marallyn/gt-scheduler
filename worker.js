export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. GET /api/profiles
    if (url.pathname === "/api/profiles" && request.method === "GET") {
      if (env.PROFILES_KV) {
        try {
          const profilesStr = await env.PROFILES_KV.get("profiles");
          const profiles = profilesStr ? JSON.parse(profilesStr) : {};
          return new Response(JSON.stringify({ success: true, profiles }), {
            headers: { 
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          });
        } catch (e) {
          return new Response(JSON.stringify({ success: false, error: `KV Error: ${e.message}` }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
      } else {
        // Fallback gracefully if KV is not bound
        return new Response(JSON.stringify({ 
          success: false, 
          error: "Cloud storage (KV) not bound. Profiles will save locally in this browser." 
        }), {
          status: 503,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // 2. POST /api/save-profile
    if (url.pathname === "/api/save-profile" && request.method === "POST") {
      if (env.PROFILES_KV) {
        try {
          const data = await request.json();
          const profileName = data.name;
          if (!profileName) {
            return new Response(JSON.stringify({ success: false, error: "Profile name is required." }), {
              status: 400,
              headers: { "Content-Type": "application/json" }
            });
          }

          // Fetch current profiles, merge, and save
          const profilesStr = await env.PROFILES_KV.get("profiles");
          const profiles = profilesStr ? JSON.parse(profilesStr) : {};
          profiles[profileName] = data;

          await env.PROFILES_KV.put("profiles", JSON.stringify(profiles));
          return new Response(JSON.stringify({ 
            success: true, 
            message: `Profile '${profileName}' saved successfully to Cloudflare KV.` 
          }), {
            headers: { "Content-Type": "application/json" }
          });
        } catch (e) {
          return new Response(JSON.stringify({ success: false, error: `KV Save Error: ${e.message}` }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
      } else {
        return new Response(JSON.stringify({ 
          success: false, 
          error: "Cloud storage (KV) not bound. Saved locally instead." 
        }), {
          status: 503,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // 3. POST /api/delete-profile
    if (url.pathname === "/api/delete-profile" && request.method === "POST") {
      if (env.PROFILES_KV) {
        try {
          const data = await request.json();
          const profileName = data.name;
          if (!profileName) {
            return new Response(JSON.stringify({ success: false, error: "Profile name is required." }), {
              status: 400,
              headers: { "Content-Type": "application/json" }
            });
          }

          const profilesStr = await env.PROFILES_KV.get("profiles");
          const profiles = profilesStr ? JSON.parse(profilesStr) : {};
          
          if (profileName in profiles) {
            delete profiles[profileName];
            await env.PROFILES_KV.put("profiles", JSON.stringify(profiles));
            return new Response(JSON.stringify({ 
              success: true, 
              message: `Profile '${profileName}' deleted from Cloudflare KV.` 
            }), {
              headers: { "Content-Type": "application/json" }
            });
          }
          return new Response(JSON.stringify({ success: false, error: "Profile not found." }), {
            status: 404,
            headers: { "Content-Type": "application/json" }
          });
        } catch (e) {
          return new Response(JSON.stringify({ success: false, error: `KV Delete Error: ${e.message}` }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
      } else {
        return new Response(JSON.stringify({ 
          success: false, 
          error: "Cloud storage (KV) not bound. Deleted locally instead." 
        }), {
          status: 503,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // 4. GET /api/fetch-subject (Not supported in serverless workers environment)
    if (url.pathname === "/api/fetch-subject") {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Updating catalog courses from the GT live website is not supported in the cloud worker. Please update courses locally using update_courses.py and redeploy." 
      }), {
        status: 501,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 5. Default: Serve static assets
    return env.ASSETS.fetch(request);
  }
};
