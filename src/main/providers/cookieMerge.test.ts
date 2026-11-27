import { describe, expect, it } from 'vitest'
import { mergeSetCookieHeaders } from './cookieMerge'

describe('mergeSetCookieHeaders', () => {
  it('updates rotated cookies in-place while preserving order and values containing =', () => {
    const initial =
      '__Secure-1PSID=long_lived_psid; __Secure-1PSIDTS=old_ts_val; NID=520=abc==; SID=sid_1'

    const merged = mergeSetCookieHeaders(initial, [
      '__Secure-1PSIDTS=new_ts_val==; expires=Sat, 27 Nov 2027 00:00:00 GMT; path=/; domain=.google.com; Secure; HttpOnly',
      '__Secure-1PSIDCC=fresh_cc; Path=/; Secure'
    ])

    expect(merged.updatedNames).toEqual(['__Secure-1PSIDTS', '__Secure-1PSIDCC'])
    expect(merged.cookieHeader).toBe(
      '__Secure-1PSID=long_lived_psid; __Secure-1PSIDTS=new_ts_val==; NID=520=abc==; SID=sid_1; __Secure-1PSIDCC=fresh_cc'
    )
  })

  it('ignores expired, Max-Age=0, deleted, empty, or unchanged Set-Cookie entries', () => {
    const initial = '__Secure-1PSID=psid_1; __Secure-1PSIDTS=ts_1'

    const merged = mergeSetCookieHeaders(initial, [
      '__Secure-1PSIDTS=ts_1; Path=/',
      '__Secure-1PSID=deleted; Max-Age=0; Path=/',
      'SID=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/',
      'FOO=EXPIRED; Path=/'
    ])

    expect(merged.updatedNames).toEqual([])
    expect(merged.cookieHeader).toBe(initial)
  })
})
