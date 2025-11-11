import requests
from bs4 import BeautifulSoup
from google.cloud import storage
import json
import re

# --- CONFIGURATION (REPLACE WITH YOUR VALUES!) ---
# These values MUST be set as GitHub Actions Secrets
BASE44_GET_ENDPOINT = "Your Base44 API GET endpoint for product list"
BASE44_POST_ENDPOINT = "Your Base44 API POST/PUT endpoint for price updates"
BASE44_API_KEY = "Your Base44 API key for authentication"
GCS_BUCKET_NAME = "your-gcs-bucket-name"

# --- 1. FUNCTION: FETCHING URLS FROM BASE44 ---
def fetch_products_from_base44():
    """Fetches the list of product URLs to track from the Base44 API."""
    headers = {
        "Authorization": f"Bearer {BASE44_API_KEY}",
        "Accept": "application/json"
    }
    
    try:
        response = requests.get(BASE44_GET_ENDPOINT, headers=headers, timeout=10)
        response.raise_for_status()
        
        # Expected response format: [{"product_id": "123", "url": "http://..."}]
        product_list = response.json() 
        
        products_to_track = {str(item.get('product_id')): item.get('url') for item in product_list if item.get('product_id') and item.get('url')}
        return products_to_track

    except Exception as e:
        print(f"ERROR: Failed to fetch product list from Base44 API: {e}")
        return {}

# --- 2. FUNCTION: WEB SCRAPING ---
def scrape_product_data(url):
    """Scrapes product data, attempting to find price and a likely main image."""
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36'}
        response = requests.get(url, headers=headers, timeout=20)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Price finding (using a general regex pattern)
        price_text_element = soup.find(text=re.compile(r'(\d[\.,]\d{2})')) 
        
        price = None
        if price_text_element:
            price_text = price_text_element.strip()
            price_text = re.sub(r'[^\d\.,]', '', price_text)
            price_text = price_text.replace(',', '.')
            match = re.search(r'\d+\.?\d*', price_text)
            price = float(match.group(0)) if match else None
            
        # Image finding (Heuristic approach)
        main_image_url = find_most_likely_image(soup)
            
        return price, main_image_url
        
    except Exception as e:
        print(f"Error scraping data from {url}: {e}")
        return None, None

def find_most_likely_image(soup):
    """Heuristically finds the most likely main product image by filtering attributes."""
    all_images = soup.find_all('img')
    best_image_url = None
    
    for img in all_images:
        src = img.get('src') or img.get('data-src') 
        if not src or src.startswith('data:image'): 
            continue
            
        # Filter out common small/unimportant images
        if any(keyword in src.lower() for keyword in ['icon', 'logo', 'badge', 'ad', 'thumb', 'svg']):
            continue

        # Prioritize larger images if dimensions are available (simple heuristic)
        width = int(img.get('width', 0))
        height = int(img.get('height', 0))
        if width > 100 and height > 100:
             return src
        
        # Fallback: if no size info, return the first plausible image found
        if not best_image_url:
            best_image_url = src
                 
    return best_image_url

# --- 3. FUNCTION: IMAGE MANAGEMENT IN GCS ---
def upload_image_to_gcs(image_url, product_id):
    """Downloads the image and uploads it to Google Cloud Storage."""
    try:
        if image_url.startswith('//'):
            image_url = 'https:' + image_url
            
        img_response = requests.get(image_url, stream=True, timeout=15)
        img_response.raise_for_status()
        
        file_extension = image_url.split('.')[-1].split('?')[0].lower() 
        if file_extension not in ['jpg', 'jpeg', 'png', 'webp', 'gif']:
             file_extension = 'jpg' 

        gcs_filename = f"products/{product_id}.{file_extension}"
        
        storage_client = storage.Client() 
        bucket = storage_client.bucket(GCS_BUCKET_NAME)
        blob = bucket.blob(gcs_filename)
        
        blob.upload_from_string(img_response.content, content_type=img_response.headers.get('Content-Type', f'image/{file_extension}'))
        blob.make_public()
        
        return blob.public_url
        
    except Exception as e:
        print(f"Error processing image for {product_id} from URL {image_url}: {e}")
        return None

# --- 4. FUNCTION: WRITING DATA TO BASE44 ---
def update_base44_db(product_id, price, image_gcs_url):
    """Sends scraped data to the Base44 internal database via its API."""
    if price is None and image_gcs_url is None:
        print(f"Skipping update for product {product_id}: No valid data found.")
        return

    data = {
        "product_id": product_id,
        "price": price,
        "image_url": image_gcs_url or "",
        "timestamp": "..."
    }

    headers = {
        "Authorization": f"Bearer {BASE44_API_KEY}",
        "Content-Type": "application/json"
    }

    try:
        response = requests.post(BASE44_POST_ENDPOINT, headers=headers, data=json.dumps(data), timeout=10)
        response.raise_for_status()
        print(f"Product {product_id} data successfully updated in Base44.")
    except Exception as e:
        print(f"Error updating Base44 database for {product_id}: {e}")


# --- MAIN PROGRAM ---
def main():
    print("Starting price tracking and image synchronization...")
    
    # CRITICAL STEP: Fetch URLs to track from Base44 API
    products_to_track = fetch_products_from_base44() 
    
    if not products_to_track:
        print("No products to track. Exiting.")
        return

    for product_id, url in products_to_track.items():
        print(f"\n Processing product ID {product_id} at URL {url}...")
        
        price, image_url = scrape_product_data(url)
        
        image_gcs_url = None
        if image_url:
            image_gcs_url = upload_image_to_gcs(image_url, product_id)
        
        update_base44_db(product_id, price, image_gcs_url)

if __name__ == "__main__":
    main()