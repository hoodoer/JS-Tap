from fastapi import FastAPI
from fastapi.responses import HTMLResponse

app = FastAPI()

@app.get("/", response_class=HTMLResponse)
async def read_root():
    content = """
    <html>
    <head>
        <title>Modern Test Page</title>
        <script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
        <script>
            if (window.jQuery) {
                console.log("Success! Remote script loaded, so CSP is not blocking it.");
            } else {
                console.log("Failure! Remote script did not load, so CSP is active.");
            }
        </script>
    </head>
    <body>
        <h1>Modern Test Page</h1>
    </body>
    </html>
    """
    headers = {
        'X-Frame-Options': 'SAMEORIGIN',
        'Content-Security-Policy': "default-src 'self'",
        'X-Launch-Status': 'Go Flight!'
    }
    return HTMLResponse(content=content, headers=headers)

@app.get("/favicon.ico")
async def favicon():
    return {} # Return a simple empty response for favicon