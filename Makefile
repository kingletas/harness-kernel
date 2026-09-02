# The test kernel. Every verb is a make target, and `make help` lists them all.
#
# The Makefile holds no logic: each recipe delegates to npm, to the selfcheck
# binary, or to a script in scripts/.

SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

NODE_MODULES := node_modules/.package-lock.json

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

$(NODE_MODULES): package.json
	npm install
	@touch $(NODE_MODULES)

.PHONY: setup
setup: $(NODE_MODULES) ## Install dependencies

.PHONY: build
build: $(NODE_MODULES) ## Compile into dist/
	@# tsc never prunes, so a renamed or deleted module stays in dist/ and goes on
	@# being imported and run -- a moved test suite ran twice before this line.
	@rm -rf dist
	npx tsc -p .

.PHONY: check
check: build lint format-check test ## Everything a commit has to pass

.PHONY: lint
lint: $(NODE_MODULES) ## Lint every source file
	npx eslint .

.PHONY: format
format: $(NODE_MODULES) ## Rewrite every file in house style
	npx prettier --write .

.PHONY: format-check
format-check: $(NODE_MODULES) ## Fail when a file is not in house style
	npx prettier --check .

.PHONY: test
test: build ## Unit-test the kernel, under a runner that is not a harness
	@# Node's own discovery, not a path: passing `dist/tests/` worked on Node 20
	@# and is read as a module name from 22 onward, which fails before a test runs.
	node --test

.PHONY: selfcheck
selfcheck: build ## Prove the kernel end to end against its own stub
	./bin/harness-selfcheck selfcheck

.PHONY: selfcheck-loud
selfcheck-loud: build ## Prove the alarm fires — expects a non-zero exit
	@./scripts/prove-alarm.sh

.PHONY: clean
clean: ## Remove build output and run artefacts
	rm -rf dist results

.PHONY: distclean
distclean: clean ## Also remove installed dependencies
	rm -rf node_modules
