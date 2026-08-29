#!/bin/bash

# SpriteNote installation script
# This script assumes:
# 1. The project folder has been manually copied to the target machine
# 2. A zipped database dump (e.g., spritenote_db.sql.zip) is present in the project folder
# 3. MariaDB/MySQL is installed and accessible
# 4. Node.js and npm are installed

set -e  # Exit on any error

echo "=== SpriteNote Installation Script ==="
echo "This script will set up SpriteNote on your new computer."
echo "Make sure you have:"
echo "  - Manually copied the project folder to this machine"
echo "  - Placed a zipped database dump (e.g., spritenote_db.sql.zip) in the project folder"
echo "  - Installed MariaDB/MySQL, Node.js, and npm"
echo ""

# Check if we're in the project directory
if [ ! -f "package.json" ] || [ ! -f "server/index.js" ]; then
  echo "Error: This script must be run from the SpriteNote project root directory."
  echo "Current directory: $(pwd)"
  echo "Please navigate to the project folder and run this script again."
  exit 1
fi

# Step 1: Install Node.js dependencies
echo "Step 1: Installing Node.js dependencies..."
npm install

# Step 2: Set up environment file
echo ""
echo "Step 2: Setting up environment variables..."
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    echo "Created .env from .env.example"
    echo "Please edit .env to set your database password and other configuration:"
    echo "  - At minimum, set DB_PASSWORD"
    echo "  - Optionally adjust DB_HOST, DB_USER, DB_NAME, PORT, HOST, etc."
    echo ""
    read -p "Have you edited .env? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Please edit .env before continuing."
      exit 1
    fi
  else
    echo "Error: .env.example not found!"
    exit 1
  fi
else
  echo ".env already exists."
fi

# Load environment variables
set -a
source .env
set +a

# Step 3: Set up database
echo ""
echo "Step 3: Setting up database..."

# Check for zipped database dump
ZIP_FILES=$(ls *.zip 2>/dev/null | head -5)  # List up to 5 zip files
if [ -z "$ZIP_FILES" ]; then
  echo "No zip files found in the project directory."
  echo "Please place a zipped database dump (e.g., spritenote_db.sql.zip) in this folder."
  echo "You can create one from your old database with:"
  echo "  mysqldump -u root -p spritenote > spritenote_db.sql"
  echo "  zip spritenote_db.sql.zip spritenote_db.sql"
  exit 1
fi

echo "Found the following zip files:"
select ZIP_FILE in $ZIP_FILES; do
  if [ -n "$ZIP_FILE" ]; then
    echo "Selected: $ZIP_FILE"
    break
  else
    echo "Invalid selection. Please try again."
  fi
done

# Unzip the database dump
echo "Unzipping $ZIP_FILE..."
SQL_FILE="${ZIP_FILE%.zip}"
if [ -f "$SQL_FILE" ]; then
  echo "$SQL_FILE already exists. Overwriting..."
  rm "$SQL_FILE"
fi
unzip -o "$ZIP_FILE"

if [ ! -f "$SQL_FILE" ]; then
  echo "Error: Failed to extract SQL file from $ZIP_FILE"
  exit 1
fi

echo "SQL file extracted: $SQL_FILE"

# Prompt for database root password (needed to create database/user if not exists)
echo ""
echo "To set up the database, I need the MariaDB root password."
echo "This is only used to create the database and user if they don't exist."
read -s -p "Enter MariaDB root password: " DB_ROOT_PASSWORD
echo

# Create database and user if they don't exist
echo "Checking if database '$DB_NAME' and user '$DB_USER' exist..."
mysql -u root -p"$DB_ROOT_PASSWORD" -e "
  CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
  GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
  FLUSH PRIVILEGES;
"

# Import the database dump
echo "Importing database dump from $SQL_FILE..."
mysql -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < "$SQL_FILE"

# Step 4: Final instructions
echo ""
echo "=== Installation Complete! ==="
echo ""
echo "Next steps:"
echo "1. Start the server:"
echo "   npm start"
echo ""
echo "2. Open your browser and go to:"
echo "   http://$HOST:$PORT"
echo ""
echo "3. Log in with your existing credentials (from the imported database)."
echo ""
echo "Notes:"
echo "- The server will automatically apply any pending database schema updates on startup."
echo "- If you encounter issues, check the logs:"
echo "   journalctl -u spritenote -f  (if using systemd)"
echo "   or run 'npm start' and see the console output"
echo ""
echo "For more information, see:"
echo "- docs/frontend.md (for frontend details)"
echo "- AGENTS.md (for architecture and principles)"
echo "- CHANGELOG.md (for recent changes)"
echo ""

# Clean up extracted SQL file? (optional, leave it in case user wants to keep it)
# rm "$SQL_FILE"