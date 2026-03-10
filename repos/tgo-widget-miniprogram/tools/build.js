/**
 * Build script: copies src/ to miniprogram_dist/
 * Also syncs to example/node_modules/tgo-widget-miniprogram (replacing symlink)
 * so that WeChat DevTools "构建 npm" can properly resolve all dependencies.
 */
const fs = require('fs')
const path = require('path')

const SRC = path.resolve(__dirname, '..', 'src')
const DIST = path.resolve(__dirname, '..', 'miniprogram_dist')

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function copyDir(src, dest) {
  ensureDir(dest)
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

// Clean & copy src -> miniprogram_dist
if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true, force: true })
}
copyDir(SRC, DIST)
console.log(`[build] Copied ${SRC} -> ${DIST}`)

// Sync to example/node_modules/tgo-widget-miniprogram
// Replaces the npm symlink with actual built files so "构建 npm" works
const EXAMPLE_NODE_MOD = path.resolve(__dirname, '..', 'example', 'node_modules', 'tgo-widget-miniprogram')
if (fs.existsSync(path.resolve(__dirname, '..', 'example', 'node_modules'))) {
  // Remove symlink or old copy
  if (fs.lstatSync(EXAMPLE_NODE_MOD).isSymbolicLink()) {
    fs.unlinkSync(EXAMPLE_NODE_MOD)
  } else if (fs.existsSync(EXAMPLE_NODE_MOD)) {
    fs.rmSync(EXAMPLE_NODE_MOD, { recursive: true, force: true })
  }
  ensureDir(EXAMPLE_NODE_MOD)
  // Must copy into miniprogram_dist/ subdirectory to match "miniprogram" field in package.json
  const EXAMPLE_MP_DIST = path.join(EXAMPLE_NODE_MOD, 'miniprogram_dist')
  copyDir(DIST, EXAMPLE_MP_DIST)
  // Copy package.json so miniprogram npm builder can read it
  const pkgSrc = path.resolve(__dirname, '..', 'package.json')
  fs.copyFileSync(pkgSrc, path.join(EXAMPLE_NODE_MOD, 'package.json'))
  console.log(`[build] Synced to ${EXAMPLE_NODE_MOD}`)

  // Transpile deps with modern syntax (optional chaining, ??) for miniprogram
  const EXAMPLE_NM = path.resolve(__dirname, '..', 'example', 'node_modules')
  const transpileTargets = [
    path.join(EXAMPLE_NM, '@json-render', 'core', 'dist', 'index.js'),
    path.join(EXAMPLE_NM, 'marked', 'lib', 'marked.esm.js'),
    path.join(EXAMPLE_NM, 'marked', 'lib', 'marked.umd.js'),
  ]
  // Also transpile all zod .cjs files
  function findCJS(dir, out) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory() && e.name !== 'node_modules') findCJS(full, out)
      else if (e.name.endsWith('.cjs')) out.push(full)
    }
  }
  const zodDir = path.join(EXAMPLE_NM, 'zod')
  if (fs.existsSync(zodDir)) findCJS(zodDir, transpileTargets)

  if (transpileTargets.length > 0) {
    const babel = require('@babel/core')
    const presetEnv = require.resolve('@babel/preset-env')
    for (const file of transpileTargets) {
      if (!fs.existsSync(file)) continue
      const code = fs.readFileSync(file, 'utf8')
      const result = babel.transformSync(code, {
        presets: [[presetEnv, { modules: 'commonjs' }]],
        babelrc: false, configFile: false, filename: file
      })
      if (result && result.code) fs.writeFileSync(file, result.code, 'utf8')
    }
    console.log(`[build] Transpiled ${transpileTargets.length} files for miniprogram`)
  }

  // Fix zod for miniprogram: npm builder only recognizes .js files,
  // but zod v4 uses .cjs throughout. Create .js copies and fix require paths.
  if (fs.existsSync(zodDir)) {
    const cjsFiles = []
    findCJS(zodDir, cjsFiles)
    for (const cjsFile of cjsFiles) {
      const jsFile = cjsFile.replace(/\.cjs$/, '.js')
      // Read the already-transpiled .cjs, replace .cjs require paths with .js
      let code = fs.readFileSync(cjsFile, 'utf8')
      code = code.replace(/require\(["']([^"']*?)\.cjs["']\)/g, 'require("$1.js")')
      fs.writeFileSync(jsFile, code, 'utf8')
    }
    // Patch zod package.json main field
    const zodPkgPath = path.join(EXAMPLE_NM, 'zod', 'package.json')
    const zodPkg = JSON.parse(fs.readFileSync(zodPkgPath, 'utf8'))
    zodPkg.main = './index.js'
    fs.writeFileSync(zodPkgPath, JSON.stringify(zodPkg, null, 2), 'utf8')
    console.log(`[build] Fixed zod: ${cjsFiles.length} .cjs -> .js copies with patched requires`)
  }
}
