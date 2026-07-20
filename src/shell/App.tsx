import { lazy, Suspense, useEffect, type ComponentType, type LazyExoticComponent } from 'react'
import { Landing } from './Landing'
import { tools, type ToolMeta } from './registry'
import { Link, usePath } from './router'

const cache = new Map<string, LazyExoticComponent<ComponentType>>()

function toolComponent(tool: ToolMeta) {
  let c = cache.get(tool.slug)
  if (!c) {
    c = lazy(tool.load)
    cache.set(tool.slug, c)
  }
  return c
}

function NotFound({ path }: { path: string }) {
  return (
    <div className="shell-notfound">
      <h1>404</h1>
      <p>
        No tool lives at <code>/{path}</code>.
      </p>
      <Link to="/" className="shell-home-btn">
        ‹ All tools
      </Link>
    </div>
  )
}

export default function App() {
  const path = usePath()
  const tool = tools.find((t) => t.slug === path)

  useEffect(() => {
    document.title = tool ? `${tool.name} · The Swiss Knife` : 'The Swiss Knife'
  }, [tool])

  if (!path) return <Landing />
  if (!tool) return <NotFound path={path} />

  const Tool = toolComponent(tool)
  return (
    <Suspense fallback={<div className="tool-loading">loading {tool.name}…</div>}>
      <Tool />
    </Suspense>
  )
}
