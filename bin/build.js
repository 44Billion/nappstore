import esbuild from 'esbuild'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import fs from 'node:fs'
import { parse } from 'jsonc-parser'

const { dirname } = import.meta
// https://github.com/evanw/esbuild/issues/2609#issuecomment-1279867125
const textLoaderMinifiedCssPlugin = {
  name: 'text-loader-minified-css',
  setup (build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      const f = await readFile(args.path)
      const css = await esbuild.transform(f, { loader: 'css', minify: true })
      return { loader: 'text', contents: css.code }
    })
  }
}

const isDev = process.env.NODE_ENV === 'development'
const prodOutdir = `${dirname}/../dist/${dirname.split('/').slice(-2, -1)}` // dist/<root dir>
const outdir = isDev
  // .serve({ servedir: `${dirname}/../src/assets/html` }) will serve app.js from memory as if it was there
  // and also index.html that ~~is~~was really there (now its an entrypoint)
  ? `${dirname}/../src/assets/html`
  // .build() will create app.js at `${dirname}/../build
  : prodOutdir

const buildNappJson = async () => {
  const inputPath = path.join(dirname, '../napp.jsonc')
  const outputPath = path.join(outdir, '.well-known/napp.json')
  const content = await readFile(inputPath, 'utf-8')
  const parsed = parse(content)
  const beautified = JSON.stringify(parsed, null, 2)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, beautified)
}

// same as esbuild.build, but reusable
const ctx = await esbuild.context({
  plugins: [textLoaderMinifiedCssPlugin],
  loader: {
    '.html': 'copy', '.ico': 'copy',
    '.svg': 'text',
    '.webp': 'dataurl'
  },
  ...(isDev
    ? {
        define: {
          IS_DEVELOPMENT: JSON.stringify(true), IS_PRODUCTION: JSON.stringify(false)
          // useLocation or route component not working with state restoration on tab reload
          // 'globalThis._F_SHOULD_RESTORE_STATE_ON_TAB_RELOAD': JSON.stringify(true)
        }
      }
    : { define: { IS_DEVELOPMENT: JSON.stringify(false), IS_PRODUCTION: JSON.stringify(true) } }),
  entryPoints: [
    `${dirname}/../src/components/app.js`,
    `${dirname}/../src/assets/html/index.html`, // will use "copy" loader
    `${dirname}/../src/assets/media/favicon.ico` // will use "copy" loader
  ],
  outdir,
  entryNames: '[name]',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  // https://caniuse.com/?search=top%20level%20await
  // edge91 and chrome91 to make signal$?.() work
  target: ['edge91', 'firefox89', 'chrome91', 'safari15'],
  minify: !isDev,
  sourcemap: isDev,
  keepNames: false, // set it to true if the code relies on (function a(){}).name === 'a'
  write: !isDev // serve from memory if isDev
})

if (isDev) {
  await ctx.watch()
  console.log('watching...')

  // esbuild's built-in web server
  const { hosts, port } = await ctx.serve({
    host: '127.0.0.1',
    // serve non-built assets from here like /index.html ~~is~~was
    // (now it's at entryPoints and has loader: { '.html': 'copy' } for it)
    // servedir must contain the outdir
    // servedir: `${dirname}/../src/assets/html`,
    // when url matches no file on ${dirname}/../src/assets/html
    fallback: `${dirname}/../src/assets/html/index.html`
  })
  console.log(`serving at http://${hosts.join('|')}:${port}`)

  process.on('SIGINT', async function () {
    console.log('Ctrl-C was pressed')
    await ctx.dispose()
    console.log('stopped watching')
  })
} else {
  const joinedProdOutDir = path.join(prodOutdir)
  // safe checks before deleting build directory
  if (
    joinedProdOutDir.startsWith(path.join(`${dirname}/..`)) &&
    joinedProdOutDir.includes('/dist/') &&
    !joinedProdOutDir.includes('..')
  ) {
    console.log(`Clearing ${joinedProdOutDir}`)
    fs.rmSync(joinedProdOutDir, { recursive: true, force: true })
  }
  console.log(`Building to ${joinedProdOutDir}`)
  await ctx.rebuild()
  await buildNappJson()
  ctx.dispose()
}
