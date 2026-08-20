/**
 * Simple 2D spatial hash for vegetation collision queries.
 * Stores entries with { x, z, scale, radius, object }.
 */
export class SpatialHash2D {
    /**
     * @param {number} cellSize
     */
    constructor(cellSize = 20) {
        this.cellSize = cellSize;
        this.cells = new Map();
        this.entries = [];
    }

    clear() {
        this.cells.clear();
        this.entries.length = 0;
    }

    _key(cx, cz) {
        return `${cx},${cz}`;
    }

    _cellCoords(x, z) {
        return [
            Math.floor(x / this.cellSize),
            Math.floor(z / this.cellSize),
        ];
    }

    /**
     * @param {{ x: number, z: number, scale?: number, radius?: number, object?: object }} entry
     */
    insert(entry) {
        this.entries.push(entry);
        const [cx, cz] = this._cellCoords(entry.x, entry.z);
        const key = this._key(cx, cz);
        let bucket = this.cells.get(key);
        if (!bucket) {
            bucket = [];
            this.cells.set(key, bucket);
        }
        bucket.push(entry);
    }

    /**
     * Query entries near a world position within a Chebyshev/manhattan-ish radius.
     * @param {number} x
     * @param {number} z
     * @param {number} radius
     * @returns {Array}
     */
    query(x, z, radius) {
        const results = [];
        const cellR = Math.ceil(radius / this.cellSize);
        const [cx, cz] = this._cellCoords(x, z);
        for (let iz = cz - cellR; iz <= cz + cellR; iz++) {
            for (let ix = cx - cellR; ix <= cx + cellR; ix++) {
                const bucket = this.cells.get(this._key(ix, iz));
                if (!bucket) continue;
                for (let i = 0; i < bucket.length; i++) {
                    results.push(bucket[i]);
                }
            }
        }
        return results;
    }
}
