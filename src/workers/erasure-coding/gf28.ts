/**
 * Galois Field GF(2^8) Arithmetic Engine & Cauchy Matrix Inversion
 *
 * Uses primitive polynomial 0x11d (x^8 + x^4 + x^3 + x^2 + 1) for GF(2^8).
 * Provides fast O(1) multiplication/division via log/exp lookup tables,
 * Cauchy generator matrix construction, and Gaussian Elimination matrix inversion.
 */

const PRIMITIVE_POLYNOMIAL = 0x11d
const FIELD_SIZE = 256

const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(FIELD_SIZE)

// Initialize GF(2^8) log and exp tables
;(function initTables() {
  let x = 1
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x <<= 1
    if (x & 0x100) {
      x ^= PRIMITIVE_POLYNOMIAL
    }
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255]
  }
  GF_LOG[0] = 0 // Log(0) undefined, mapped to 0
})()

/** GF(2^8) Addition / Subtraction (XOR) */
export function gfAdd(a: number, b: number): number {
  return a ^ b
}

/** GF(2^8) Multiplication */
export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return GF_EXP[GF_LOG[a] + GF_LOG[b]]
}

/** GF(2^8) Division */
export function gfDiv(a: number, b: number): number {
  if (a === 0) return 0
  if (b === 0) throw new Error('GF(2^8) Division by zero')
  return GF_EXP[GF_LOG[a] - GF_LOG[b] + 255]
}

/** GF(2^8) Inverse (1 / a) */
export function gfInv(a: number): number {
  if (a === 0) throw new Error('GF(2^8) Inverse of zero')
  return GF_EXP[255 - GF_LOG[a]]
}

/**
 * Creates a Cauchy Matrix of size (K + M) x K.
 * Top K x K is the Identity matrix (Data rows).
 * Bottom M x K is the Cauchy matrix (Parity rows): C_ij = 1 / (X_i ^ Y_j)
 */
export function createCauchyMatrix(K: number, M: number): Uint8Array[] {
  const rows: Uint8Array[] = []

  // Top K x K Identity matrix
  for (let i = 0; i < K; i++) {
    const row = new Uint8Array(K)
    row[i] = 1
    rows.push(row)
  }

  // Bottom M x K Cauchy matrix
  // Choose distinct sets X = {0..M-1} and Y = {M..M+K-1} to avoid X_i == Y_j
  for (let i = 0; i < M; i++) {
    const row = new Uint8Array(K)
    const xi = i
    for (let j = 0; j < K; j++) {
      const yj = M + j
      const diff = xi ^ yj
      row[j] = gfInv(diff)
    }
    rows.push(row)
  }

  return rows
}

/**
 * Inverts a K x K matrix in GF(2^8) using Gaussian Elimination.
 */
export function invertMatrix(matrix: Uint8Array[]): Uint8Array[] {
  const K = matrix.length
  // Create augmented matrix [matrix | Identity]
  const aug: Uint8Array[] = []
  for (let i = 0; i < K; i++) {
    const row = new Uint8Array(K * 2)
    for (let j = 0; j < K; j++) {
      row[j] = matrix[i][j]
    }
    row[K + i] = 1
    aug.push(row)
  }

  // Perform Gaussian Elimination
  for (let i = 0; i < K; i++) {
    // Find pivot row
    let pivot = i
    while (pivot < K && aug[pivot][i] === 0) {
      pivot++
    }
    if (pivot === K) {
      throw new Error('Matrix is singular and cannot be inverted')
    }

    // Swap current row with pivot row
    if (pivot !== i) {
      const temp = aug[i]
      aug[i] = aug[pivot]
      aug[pivot] = temp
    }

    // Scale pivot row so leading coefficient is 1
    const pivotVal = aug[i][i]
    if (pivotVal !== 1) {
      const invPivot = gfInv(pivotVal)
      for (let j = 0; j < K * 2; j++) {
        aug[i][j] = gfMul(aug[i][j], invPivot)
      }
    }

    // Eliminate column elements in all other rows
    for (let r = 0; r < K; r++) {
      if (r !== i && aug[r][i] !== 0) {
        const factor = aug[r][i]
        for (let j = 0; j < K * 2; j++) {
          aug[r][j] = gfAdd(aug[r][j], gfMul(aug[i][j], factor))
        }
      }
    }
  }

  // Extract inverse matrix (right half of augmented matrix)
  const inverse: Uint8Array[] = []
  for (let i = 0; i < K; i++) {
    const row = new Uint8Array(K)
    for (let j = 0; j < K; j++) {
      row[j] = aug[i][K + j]
    }
    inverse.push(row)
  }

  return inverse
}
