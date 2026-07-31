"use client";
import { useEffect, useState } from 'react'

/* Anything dropped into public/brand/ overrides the shipped default without a
   code change. We probe the file once; if it loads, it wins. See its README. */

export const brandUrl = (file) => `/brand/${file}`

const probe = (url) =>
  new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img.naturalWidth > 0)
    img.onerror = () => resolve(false)
    img.src = url
  })

/* Try every common extension so a dropped-in file works whatever it was saved as. */
const EXTS = ['png', 'jpg', 'jpeg', 'webp', 'svg', 'avif', 'PNG', 'JPG', 'JPEG']
const variants = (base) => EXTS.map((e) => `${base}.${e}`)

/** First existing variant of `base`, or null. */
async function findFirst(base) {
  for (const name of variants(base)) {
    // eslint-disable-next-line no-await-in-loop
    if (await probe(brandUrl(name))) return brandUrl(name)
  }
  return null
}

/**
 * Takes { key: 'basename' } and returns { key: url } for the files that exist,
 * matching any image extension. Keys absent fall back to the shipped default.
 */
export function useBrandOverrides(bases) {
  const [found, setFound] = useState({})
  useEffect(() => {
    let alive = true
    Object.entries(bases).forEach(([key, base]) => {
      findFirst(base).then((url) => {
        if (url && alive) setFound((prev) => (prev[key] ? prev : { ...prev, [key]: url }))
      })
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return found
}

/** The logo file, whatever extension it was saved as. */
export function useBrandFile(base) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let alive = true
    findFirst(base).then((u) => { if (u && alive) setUrl(u) })
    return () => { alive = false }
  }, [base])
  return url
}
