from bs4 import BeautifulSoup
import sys

def extract_csrf_token(file_name, input_name):


	# Read HTML content from the file
    with open(file_path, 'r', encoding='utf-8') as file:
        html_content = file.read()

    soup = BeautifulSoup(html_content, 'lxml')
    # Find the input element with the specified name attribute
    csrf_input = soup.find('input', attrs={'name': input_name})
    if csrf_input:
        # Return the value attribute of the found input element
        return csrf_input.get('value')
    return None

input_name = "_wpnonce_create-user"


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python script.py <filename>")
        sys.exit(1)

    file_path = sys.argv[1]
    token = extract_csrf_token(file_path, input_name)
    print(f"Extracted CSRF Token: {token}")