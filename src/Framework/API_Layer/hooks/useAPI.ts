'use client'

import {
  useQuery,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
} from '@tanstack/react-query'
import { BAPI } from '../BAPI'
import type { BApiOptions } from '../types/APITypes'

/**
 * Wraps `BAPI.get` in a TanStack Query `useQuery`.
 *
 * The query key is `[url, params]` so the query auto-refetches whenever
 * the URL or params change (useful for paginated / filtered lists).
 *
 * @example
 * const { data, isLoading } = useGet<User[]>('/users', { useCache: true, cacheTTL: 60_000 })
 */
export function useGet<T>(
  url: string,
  options?: BApiOptions,
  queryOptions?: Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery<T, Error>({
    queryKey: [url, options?.params],
    queryFn: () => BAPI.get<T>(url, options),
    ...queryOptions,
  })
}

/**
 * Wraps `BAPI.post` in a TanStack Query `useMutation`.
 * `TData` is the shape of the object passed to `mutate(...)`.
 *
 * @example
 * const { mutate } = usePost<User>('/users')
 * mutate({ name: 'John' })
 */
export function usePost<TResponse, TData = unknown>(
  url: string,
  options?: BApiOptions,
  mutationOptions?: Omit<UseMutationOptions<TResponse, Error, TData>, 'mutationFn'>
) {
  return useMutation<TResponse, Error, TData>({
    mutationFn: (data) => BAPI.post<TResponse>(url, data, options),
    ...mutationOptions,
  })
}

/**
 * Wraps `BAPI.put` in a TanStack Query `useMutation`.
 *
 * @example
 * const { mutate } = usePut<User>('/users/1')
 * mutate({ name: 'Jane' })
 */
export function usePut<TResponse, TData = unknown>(
  url: string,
  options?: BApiOptions,
  mutationOptions?: Omit<UseMutationOptions<TResponse, Error, TData>, 'mutationFn'>
) {
  return useMutation<TResponse, Error, TData>({
    mutationFn: (data) => BAPI.put<TResponse>(url, data, options),
    ...mutationOptions,
  })
}

/**
 * Wraps `BAPI.patch` in a TanStack Query `useMutation`.
 *
 * @example
 * const { mutate } = usePatch<User>('/users/1')
 * mutate({ bio: 'Updated' })
 */
export function usePatch<TResponse, TData = unknown>(
  url: string,
  options?: BApiOptions,
  mutationOptions?: Omit<UseMutationOptions<TResponse, Error, TData>, 'mutationFn'>
) {
  return useMutation<TResponse, Error, TData>({
    mutationFn: (data) => BAPI.patch<TResponse>(url, data, options),
    ...mutationOptions,
  })
}

/**
 * Wraps `BAPI.delete` in a TanStack Query `useMutation`.
 * Pass a body as `TData` if the endpoint requires one; omit if not.
 *
 * @example
 * const { mutate } = useDelete<void>('/users/1')
 * mutate(undefined)
 */
export function useDelete<TResponse, TData = unknown>(
  url: string,
  options?: BApiOptions,
  mutationOptions?: Omit<UseMutationOptions<TResponse, Error, TData>, 'mutationFn'>
) {
  return useMutation<TResponse, Error, TData>({
    mutationFn: (data) => BAPI.delete<TResponse>(url, data, options),
    ...mutationOptions,
  })
}
