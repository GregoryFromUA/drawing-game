#!/bin/bash

echo "🧪 QUICK TEST SCRIPT FOR DRAWING GAME"
echo "======================================"
echo ""

# Кольори для виводу
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Step 1: Installing dependencies...${NC}"
npm install
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ npm install failed!${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Dependencies installed${NC}"
echo ""

echo -e "${YELLOW}Step 2: Building project...${NC}"
npm run build
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed!${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Build successful${NC}"
echo ""

echo -e "${YELLOW}Step 3: Checking dist/ directory...${NC}"
if [ ! -d "dist" ]; then
    echo -e "${RED}❌ dist/ directory not found!${NC}"
    exit 1
fi

if [ ! -f "dist/index.html" ]; then
    echo -e "${RED}❌ dist/index.html not found!${NC}"
    exit 1
fi

echo -e "${GREEN}✅ dist/ directory exists with files${NC}"
ls -lh dist/
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ ALL CHECKS PASSED!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Now you can start the server:"
echo -e "${YELLOW}  npm run server${NC}"
echo ""
echo "Then open: ${YELLOW}http://localhost:3001${NC}"
echo ""
echo "For development mode (with hot reload):"
echo -e "${YELLOW}  Terminal 1: npm run dev${NC}"
echo -e "${YELLOW}  Terminal 2: npm run server:dev${NC}"
echo -e "  Then open: ${YELLOW}http://localhost:3000${NC}"
