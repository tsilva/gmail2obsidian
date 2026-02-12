push:
	clasp push

deploy:
	clasp push && clasp deploy -d "$(shell date +%Y-%m-%d_%H:%M)"

open:
	clasp open

login:
	clasp login

setup:
	git config core.hooksPath .githooks
	@test -f .clasp.json || echo '{"scriptId":"YOUR_SCRIPT_ID_HERE","rootDir":"."}' > .clasp.json
	@echo ""
	@echo "Setup complete. Next steps:"
	@echo "  1. npm install -g @google/clasp"
	@echo "  2. make login"
	@echo "  3. Enable Apps Script API: https://script.google.com/home/usersettings"
	@echo "  4. Copy your Script ID from: script.google.com > Project Settings"
	@echo "  5. Edit .clasp.json and replace YOUR_SCRIPT_ID_HERE"
	@echo "  6. make push"
