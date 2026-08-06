# Leo's Blog - Hexo source

This directory is the maintainable Hexo project. The repository root contains
the old generated static site and is kept as a backup.

## First setup on a new computer

Install Node.js 20.19 or newer and Git, then run:

```powershell
cd D:\web\littlestar\hexo-source
npm.cmd ci
npm.cmd run server
```

Open <http://localhost:4000/>.

The project uses a local Hexo installation, so installing `hexo-cli` globally
is not required. `npm.cmd` is used in the examples because some Windows
PowerShell installations block the `npm.ps1` wrapper.

## Common commands

```powershell
# Create a post
npm.cmd run new -- "文章标题"

# Clean and build static files into public/
npm.cmd run clean
npm.cmd run build

# Preview locally
npm.cmd run server

# Manual deployment to gh-pages
npm.cmd run deploy
```

## Content and configuration

- Posts: `source/_posts/`
- Static images: `source/image/` and `source/assets/`
- Hexo configuration: `_config.yml`
- Butterfly overrides: `_config.butterfly.yml`

The former custom domain `littlestar1128.top` is not included in the generated
site because it currently resolves to a parking page. Restore its DNS before
adding `source/CNAME` and changing `url` back to the custom domain.
