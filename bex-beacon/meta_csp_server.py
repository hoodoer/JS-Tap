from flask import Flask, Response, request

app = Flask(__name__)

@app.route('/')
def index():
    # Check for a URL parameter to disable the CSP meta tag
    csp_enabled = request.args.get('csp', 'true').lower() == 'true'

    csp_meta_tag = ''
    if csp_enabled:
        csp_meta_tag = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\';">'

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Meta CSP Test Page</title>
        <!-- CSP meta tag is conditionally included by the server -->
        {csp_meta_tag}
        <script src="https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js"></script>
        <script>
            // This script now checks for Lodash ('_').
            if (window._) {{
                console.log("SUCCESS: Remote script (Lodash) loaded!");
            }} else {{
                console.log("FAILURE: Remote script (Lodash) DID NOT load, likely due to CSP.");
            }}
        </script>
    </head>
    <body>
        <h1>Meta CSP Test Page</h1>
        <p>This page now conditionally serves a CSP meta tag based on a URL parameter.</p>
        <p>CSP enabled for this page load: <strong>{csp_enabled}</strong></p>
    </body>
    </html>
    """
    return Response(html_content, mimetype='text/html')

if __name__ == '__main__':
    app.run(port=8001)
