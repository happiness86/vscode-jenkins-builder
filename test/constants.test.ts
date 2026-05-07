import { describe, expect, it } from 'vitest'
import { SECRET_API_TOKEN_KEY } from '../src/constants'

describe('constants', () => {
  it('uses stable secret storage key', () => {
    expect(SECRET_API_TOKEN_KEY).toBe('jenkinsBuilder.apiToken')
  })
})
