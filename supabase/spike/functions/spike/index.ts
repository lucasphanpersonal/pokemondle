import { hello } from '../_shared/hello.ts'

Deno.serve(() => new Response(hello('party'), { headers: { 'content-type': 'text/plain' } }))
