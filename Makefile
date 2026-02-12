require-config:
	@test -f config.gs || (echo "Error: config.gs not found. Run 'make setup' first, then edit config.gs" && exit 1)

push: require-config
	clasp push

deploy: require-config
	clasp push
	@clasp deployments | grep -v '@HEAD' | grep -o 'AKfycb[^ ]*' | while read id; do clasp undeploy "$$id"; done
	@RESULT=$$(clasp deploy -d "$$(date +%Y-%m-%d_%H:%M)"); \
		echo "$$RESULT"; \
		ID=$$(echo "$$RESULT" | grep -o 'AKfycb[^ .]*'); \
		echo ""; \
		echo "Web app URL: https://script.google.com/macros/s/$$ID/exec"

open:
	clasp open

login:
	clasp login

setup:
	git config core.hooksPath .githooks
	@test -f .clasp.json || echo '{"scriptId":"YOUR_SCRIPT_ID_HERE","rootDir":"."}' > .clasp.json
	@test -f config.gs || cp config.example.gs config.gs
	@echo ""
	@echo "Setup complete. Next steps:"
	@echo "  1. npm install -g @google/clasp"
	@echo "  2. make login"
	@echo "  3. Enable Apps Script API: https://script.google.com/home/usersettings"
	@echo "  4. Copy your Script ID from: script.google.com > Project Settings"
	@echo "  5. Edit .clasp.json and replace YOUR_SCRIPT_ID_HERE"
	@echo "  6. Edit config.gs with your vault path and routes"
	@echo "  7. make deploy"
