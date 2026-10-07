import { createPrismaClient } from '@/lib/prisma'

// Process-scoped cache for role lookups
let roleCache: Map<string, { id: string; name: string; hierarchy: number }> | null = null
let permissionCache: Map<string, Set<string>> | null = null // roleName -> Set<permissionName>

/**
 * Gets a role by name from database (with process-scoped caching)
 */
export async function getRoleByName(name: string) {
  if (!roleCache) {
    await refreshRoleCache()
  }
  return roleCache?.get(name)
}

/**
 * Refreshes the role cache from database
 */
async function refreshRoleCache() {
  const prisma = createPrismaClient()
  const roles = await prisma.role.findMany({
    select: {
      id: true,
      name: true,
      hierarchy: true,
    },
  })

  roleCache = new Map()
  for (const role of roles) {
    roleCache.set(role.name, role)
  }
}

/**
 * Gets permissions for a role from database (with process-scoped caching)
 */
async function getRolePermissions(roleName: string): Promise<Set<string>> {
  if (!permissionCache) {
    await refreshPermissionCache()
  }
  return permissionCache?.get(roleName) || new Set()
}

/**
 * Refreshes the permission cache from database
 */
async function refreshPermissionCache() {
  const prisma = createPrismaClient()
  const rolePermissions = await prisma.rolePermission.findMany({
    include: {
      role: {
        select: { name: true },
      },
      permission: {
        select: { name: true },
      },
    },
  })

  permissionCache = new Map()
  for (const rp of rolePermissions) {
    const roleName = rp.role.name
    if (!permissionCache.has(roleName)) {
      permissionCache.set(roleName, new Set())
    }
    permissionCache.get(roleName)!.add(rp.permission.name)
  }
}

/**
 * Gets role name from either database object or string
 */
export function getRoleName(role: string | { name: string }): string {
  if (typeof role === 'string') {
    return role
  }
  if (typeof role === 'object' && 'name' in role) {
    return role.name
  }
  return role as string
}

/**
 * Checks if a role has a specific permission (database-first with cache)
 */
export async function hasPermissionDB(
  role: string | { name: string },
  permission: string
): Promise<boolean> {
  const roleName = getRoleName(role)

  try {
    const permissions = await getRolePermissions(roleName)
    return permissions.has(permission)
  } catch (error) {
    console.warn(`Failed to check permission in database for role ${roleName}:`, error)
    return false
  }
}

/**
 * Gets role ID from database for a role name
 */
export async function getRoleIdByName(roleName: string): Promise<string | null> {
  const role = await getRoleByName(roleName)
  return role?.id || null
}

/**
 * Refreshes all process-scoped caches (call this after role/permission changes)
 */
export async function refreshCaches() {
  roleCache = null
  permissionCache = null
}
