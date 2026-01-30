Hexo source skeleton generated from static output.

Usage:

1. Install dependencies:

```
cd hexo-source
npm install
```

2. Install Butterfly theme:

```
git clone https://github.com/jerryc127/hexo-theme-butterfly themes/butterfly
# then configure theme in _config.yml if needed
```

3. Run locally:

```
npm run start
```

This project contains two imported posts converted from the static site.

Notes:
- Static resources (css/js/images/assets) from the original static site have been copied into `hexo-source/source/` so the imported posts reference should work without extra changes.

Theme and build notes:
- Clone the Butterfly theme into `themes/butterfly` (recommended):
	```powershell
	git clone https://github.com/jerryc127/hexo-theme-butterfly.git themes/butterfly
	```
- Install pug/stylus renderers (required by the theme):
	```powershell
	npm install hexo-renderer-pug hexo-renderer-stylus --save
	```

Local build (Windows PowerShell):
```powershell
cd hexo-source
# ensure Node.js and npm are installed
npm install
npm run start
```

CI / Deploy:
- A GitHub Actions workflow `.github/workflows/hexo-deploy.yml` is included to build and deploy `hexo-source/public` to the `gh-pages` branch. Configure the deploy repository in `_config.yml` or use the provided action which publishes the generated `public` folder.
  
Example: the deploy repo has been set to `https://github.com/littlestar1128/littlestar1128.github.io.git` in `_config.yml` — change it if you want to deploy to a different repository.

