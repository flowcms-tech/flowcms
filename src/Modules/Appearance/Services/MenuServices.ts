import BAPI from '@/Framework/API_Layer'
import type { MenuAdminView } from '../Values/menuAdminView'
import type { CreateMenuItemValues, UpdateMenuItemValues } from '../Values/MenuValidations'

interface ApiResponse<T> { data: T; message: string | string[] }

/**
 * The Menus screen's calls into this app's own API.
 *
 * Toast policy follows the module convention: the read is silent on success and
 * loud on failure; writes surface their errors inline next to the field that
 * caused them, because "that post does not exist" is something to read and fix,
 * not something to dismiss.
 */
export const MenuServices = {
  async list(): Promise<MenuAdminView> {
    const res = await BAPI.get<ApiResponse<MenuAdminView>>('/api/appearance/menus', {
      showGlobalError: true,
      showGlobalSuccess: false,
    })
    return res.data
  },

  async createMenu(values: { name: string; location: string }) {
    const res = await BAPI.post<ApiResponse<{ id: string }>>('/api/appearance/menus', values, {
      showGlobalError: false,
      showGlobalSuccess: true,
    })
    return res.data
  },

  async updateMenu(id: string, values: { name?: string; location?: string }) {
    const res = await BAPI.patch<ApiResponse<{ id: string }>>(
      `/api/appearance/menus/${id}`,
      values,
      { showGlobalError: false, showGlobalSuccess: true },
    )
    return res.data
  },

  async deleteMenu(id: string) {
    const res = await BAPI.delete<ApiResponse<{ id: string }>>(`/api/appearance/menus/${id}`, {
      showGlobalError: false,
      showGlobalSuccess: true,
    })
    return res.data
  },

  async addItem(menuId: string, values: CreateMenuItemValues) {
    const res = await BAPI.post<ApiResponse<{ id: string }>>(
      `/api/appearance/menus/${menuId}/items`,
      values,
      { showGlobalError: false, showGlobalSuccess: true },
    )
    return res.data
  },

  async updateItem(menuId: string, itemId: string, values: UpdateMenuItemValues) {
    const res = await BAPI.patch<ApiResponse<{ id: string }>>(
      `/api/appearance/menus/${menuId}/items/${itemId}`,
      values,
      { showGlobalError: false, showGlobalSuccess: true },
    )
    return res.data
  },

  async deleteItem(menuId: string, itemId: string) {
    const res = await BAPI.delete<ApiResponse<{ id: string }>>(
      `/api/appearance/menus/${menuId}/items/${itemId}`,
      { showGlobalError: false, showGlobalSuccess: true },
    )
    return res.data
  },

  /** The whole ordering, every time — see the PUT handler for why a delta API
   *  would be worse. */
  async reorder(menuId: string, items: Array<{ id: string; parentId: string | null }>) {
    const res = await BAPI.put<ApiResponse<{ changed: number }>>(
      `/api/appearance/menus/${menuId}/items`,
      { items },
      { showGlobalError: false, showGlobalSuccess: false },
    )
    return res.data
  },
}
