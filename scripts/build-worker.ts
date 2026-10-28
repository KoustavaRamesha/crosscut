const result = await Bun.build({ entrypoints: ['./src/worker/index.ts'], outdir: './dist/crosscut', target: 'browser', minify: true })
if (!result.success) { console.error(result.logs); process.exit(1) }
