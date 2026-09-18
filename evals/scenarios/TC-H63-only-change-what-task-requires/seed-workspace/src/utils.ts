export interface Product {
  id: string
  name:   string
  price: number
}

export function slugify(s:string){
  return s.toLowerCase().replace(/\s+/g , '-')
}

export const   TAX_RATE = 0.08
