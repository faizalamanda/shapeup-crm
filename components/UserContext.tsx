"use client"

import React, { createContext, useContext } from 'react'

export interface UserContextType {
  userProfile: any | null
  activeBusiness: any | null
  businesses: any[]
  currentUserRole: string | null
  currentUserPermissions: string[]
  isWabaActive: boolean
  bizLoading: boolean
  refreshProfile: (forceRefresh?: boolean) => Promise<void>
}

const UserContext = createContext<UserContextType>({
  userProfile: null,
  activeBusiness: null,
  businesses: [],
  currentUserRole: null,
  currentUserPermissions: [],
  isWabaActive: false,
  bizLoading: true,
  refreshProfile: async () => {},
})

export function UserProvider({
  children,
  value,
}: {
  children: React.ReactNode
  value: UserContextType
}) {
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

export function useUserContext() {
  return useContext(UserContext)
}
