class QuadKeyApp {
    constructor() {
        this.map = null;
        this.currentQuadkeyLayer = null;
        this.currentBboxLayer = null;
        this.isBboxDrawing = false;
        this.bboxStartLatLng = null;

        this.init();
    }

    init() {
        this.initializeMap();
        this.setupEventListeners();
    }

    initializeMap() {
        this.map = L.map('map').setView([45.933841, 46.408825], 5);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(this.map);
    }

    setupEventListeners() {
        this.map.on('click', (e) => this.handleMapClick(e));
        this.map.on('mousemove', (e) => this.updateBboxPreview(e));

        document.getElementById('quadkey-mode').addEventListener('change', () => this.updateModeInstructions());
        document.getElementById('bbox-mode').addEventListener('change', () => this.updateModeInstructions());
    }

    // Utility functions
    static normalizeLongitude(lon) {
        return ((lon + 180) % 360 + 360) % 360 - 180;
    }

    static latLonToQuadKey(lat, lon, zoomLevel) {
        const toTileX = (lon, zoom) =>
            Math.floor(((lon + 180) / 360) * Math.pow(2, zoom)) % Math.pow(2, zoom);

        const toTileY = (lat, zoom) =>
            Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));

        const tileXYToQuadKey = (x, y, zoom) => {
            let quadKey = '';
            for (let i = zoom; i > 0; i--) {
                let digit = 0;
                const mask = 1 << (i - 1);
                if ((x & mask) !== 0) digit++;
                if ((y & mask) !== 0) digit += 2;
                quadKey += digit;
            }
            return quadKey;
        };

        const tileX = toTileX(lon, zoomLevel);
        const tileY = toTileY(lat, zoomLevel);
        return tileXYToQuadKey(tileX, tileY, zoomLevel);
    }

    static tileToBounds(x, y, zoom) {
        const n = Math.pow(2, zoom);
        const lon1 = (x / n) * 360.0 - 180.0;
        const lat1 = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180.0 / Math.PI;
        const lon2 = ((x + 1) / n) * 360.0 - 180.0;
        const lat2 = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180.0 / Math.PI;

        return [[lat1, lon1], [lat2, lon2]]; // SW and NE corners
    }

    static boundsToWKT(bounds) {
        const [[lat1, lon1], [lat2, lon2]] = bounds;
        const sw = [lat1, lon1];
        const ne = [lat2, lon2];
        const nw = [ne[0], sw[1]];
        const se = [sw[0], ne[1]];
        return `POLYGON((${sw[1]} ${sw[0]}, ${se[1]} ${se[0]}, ${ne[1]} ${ne[0]}, ${nw[1]} ${nw[0]}, ${sw[1]} ${sw[0]}))`;
    }

    static boundsToGeoJSON(bounds) {
        const [[lat1, lon1], [lat2, lon2]] = bounds;
        const sw = [lat1, lon1];
        const ne = [lat2, lon2];
        const nw = [ne[0], sw[1]];
        const se = [sw[0], ne[1]];
        return JSON.stringify({
            type: "Polygon",
            coordinates: [[[sw[1], sw[0]], [se[1], se[0]], [ne[1], ne[0]], [nw[1], nw[0]], [sw[1], sw[0]]]]
        });
    }

    // Clipboard utilities
    static async copyToClipboard(text, element) {
        try {
            await navigator.clipboard.writeText(text);
            QuadKeyApp.showCopyFeedback(element, '#f0f0f0');
        } catch (err) {
            console.error('Failed to copy: ', err);
            alert('Copy failed - please select and copy manually');
        }
    }

    static async copyFormat(text, button) {
        try {
            await navigator.clipboard.writeText(text);
            QuadKeyApp.showCopyFeedback(button, '#007cff');
        } catch (err) {
            console.error('Failed to copy: ', err);
            alert('Copy failed - please select and copy manually');
        }
    }

    static showCopyFeedback(element, originalColor) {
        const originalText = element.textContent;
        element.textContent = 'Copied!';
        element.style.backgroundColor = '#90EE90';
        if (originalColor === '#007cff') {
            element.style.color = 'white';
        }

        setTimeout(() => {
            element.textContent = originalText;
            element.style.backgroundColor = originalColor === '#007cff' ? 'white' : originalColor;
            if (originalColor === '#007cff') {
                element.style.color = '#007cff';
            }
        }, 1000);
    }

    getSelectedZoomLevel() {
        return parseInt(document.getElementById('zoom-select').value);
    }

    getCurrentMode() {
        return document.querySelector('input[name="mode"]:checked').value;
    }

    // Output generation
    generateOutput(data) {
        const { type, ...outputData } = data;

        if (type === 'quadkey') {
            return this.generateQuadkeyOutput(outputData);
        } else if (type === 'bbox') {
            return this.generateBboxOutput(outputData);
        }
    }

    generateQuadkeyOutput({ quadkey, latLonText, tileText, bbox_string, wkt, geojson }) {
        return `
            <div class="output-row">
                <span class="output-label">Quadkey:</span>
                <span class="copyable" onclick="QuadKeyApp.copyToClipboard('${quadkey}', this)">${quadkey}</span>
            </div>
            <div class="output-row">
                <span class="output-label">Lat,Lon:</span>
                <span class="copyable" onclick="QuadKeyApp.copyToClipboard('${latLonText}', this)">${latLonText}</span>
            </div>
            <div class="output-row">
                <span class="output-label">Z/X/Y:</span>
                <span class="copyable" onclick="QuadKeyApp.copyToClipboard('${tileText}', this)">${tileText}</span>
            </div>
            <div class="output-row">
                <span class="output-label">Bbox:</span>
                <span class="copyable" onclick="QuadKeyApp.copyToClipboard('${bbox_string}', this)">${bbox_string}</span>
            </div>
            ${this.generateFormatButtons(wkt, geojson)}
        `;
    }

    generateBboxOutput({ bboxString, wkt, geojson }) {
        return `
            <div class="output-row">
                <span class="output-label">Bbox:</span>
                <span class="copyable" onclick="QuadKeyApp.copyToClipboard('${bboxString}', this)">${bboxString}</span>
            </div>
            ${this.generateFormatButtons(wkt, geojson)}
        `;
    }

    generateFormatButtons(wkt, geojson) {
        return `
            <div class="format-buttons">
                <button class="format-button" data-wkt="${wkt.replace(/"/g, '&quot;')}" onclick="QuadKeyApp.copyFormat(this.dataset.wkt, this)">Copy WKT</button>
                <button class="format-button" data-geojson="${geojson.replace(/"/g, '&quot;')}" onclick="QuadKeyApp.copyFormat(this.dataset.geojson, this)">Copy GeoJSON</button>
            </div>
        `;
    }

    // Event handlers
    handleMapClick(e) {
        if (this.getCurrentMode() === 'bbox') {
            this.handleBboxClick(e);
        } else if (this.getCurrentMode() === 'quadkey') {
            this.handleQuadkeyClick(e);
        }
    }

    handleQuadkeyClick(e) {
        const { lat, lng: lon } = e.latlng;
        const normalizedLon = QuadKeyApp.normalizeLongitude(lon);
        const zoomLevel = this.getSelectedZoomLevel();

        // Calculate tile coordinates
        const tileX = Math.floor(((lon + 180) / 360) * Math.pow(2, zoomLevel)) % Math.pow(2, zoomLevel);
        const tileY = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoomLevel));

        const quadkey = QuadKeyApp.latLonToQuadKey(lat, lon, zoomLevel);
        const bounds = QuadKeyApp.tileToBounds(tileX, tileY, zoomLevel);

        // Update map visualization
        this.updateQuadkeyLayer(bounds);
        this.fitMapToBounds(bounds, zoomLevel);

        // Generate output data
        const outputData = this.prepareQuadkeyData(quadkey, lat, normalizedLon, zoomLevel, tileX, tileY, bounds);
        document.getElementById('quadkey-output').innerHTML = this.generateOutput(outputData);
    }

    updateQuadkeyLayer(bounds) {
        if (this.currentQuadkeyLayer) {
            this.map.removeLayer(this.currentQuadkeyLayer);
        }
        this.currentQuadkeyLayer = L.rectangle(bounds, { color: '#ff7800', weight: 2 }).addTo(this.map);
    }

    fitMapToBounds(bounds, zoomLevel) {
        const tileBounds = L.latLngBounds(bounds);
        this.map.fitBounds(tileBounds, {
            padding: [50, 50],
            maxZoom: Math.max(zoomLevel + 2, this.map.getZoom())
        });
    }

    prepareQuadkeyData(quadkey, lat, normalizedLon, zoomLevel, tileX, tileY, bounds) {
        const latLonText = `${lat.toFixed(6)},${normalizedLon.toFixed(6)}`;
        const tileText = `${zoomLevel}/${tileX}/${tileY}`;

        // Calculate bbox string
        const [[lat1, lon1], [lat2, lon2]] = bounds;
        const sw_corner = [lat2, lon1];
        const ne_corner = [lat1, lon2];
        const bbox_string = `${sw_corner[1].toFixed(6)},${sw_corner[0].toFixed(6)},${ne_corner[1].toFixed(6)},${ne_corner[0].toFixed(6)}`;

        const wkt = QuadKeyApp.boundsToWKT(bounds);
        const geojson = QuadKeyApp.boundsToGeoJSON(bounds);

        return {
            type: 'quadkey',
            quadkey,
            latLonText,
            tileText,
            bbox_string,
            wkt,
            geojson
        };
    }

    handleBboxClick(e) {
        if (!this.isBboxDrawing) {
            this.startBboxDrawing(e);
        } else {
            this.finishBboxDrawing(e);
        }
    }

    startBboxDrawing(e) {
        this.isBboxDrawing = true;
        this.bboxStartLatLng = e.latlng;

        if (this.currentBboxLayer) {
            this.map.removeLayer(this.currentBboxLayer);
        }

        const startMarker = L.circleMarker(e.latlng, {
            color: '#007cff',
            fillColor: '#007cff',
            fillOpacity: 0.8,
            radius: 5
        }).addTo(this.map);
        this.currentBboxLayer = startMarker;

        document.getElementById('quadkey-output').innerHTML =
            '<div class="instruction-text">Click again to finish drawing the bounding box</div>';
    }

    finishBboxDrawing(e) {
        this.isBboxDrawing = false;

        const bounds = this.calculateBboxBounds(e.latlng);
        this.updateBboxLayer(bounds);

        const outputData = this.prepareBboxData(bounds);
        document.getElementById('quadkey-output').innerHTML = this.generateOutput(outputData);
    }

    calculateBboxBounds(endLatLng) {
        const west = Math.min(this.bboxStartLatLng.lng, endLatLng.lng);
        const south = Math.min(this.bboxStartLatLng.lat, endLatLng.lat);
        const east = Math.max(this.bboxStartLatLng.lng, endLatLng.lng);
        const north = Math.max(this.bboxStartLatLng.lat, endLatLng.lat);

        return [[south, west], [north, east]];
    }

    updateBboxLayer(bounds) {
        if (this.currentBboxLayer) {
            this.map.removeLayer(this.currentBboxLayer);
        }
        this.currentBboxLayer = L.rectangle(bounds, {
            color: '#007cff',
            weight: 2,
            fillOpacity: 0.1
        }).addTo(this.map);
    }

    prepareBboxData(bounds) {
        const [[south, west], [north, east]] = bounds;
        const bboxString = `${west.toFixed(6)},${south.toFixed(6)},${east.toFixed(6)},${north.toFixed(6)}`;
        const wkt = QuadKeyApp.boundsToWKT(bounds);
        const geojson = QuadKeyApp.boundsToGeoJSON(bounds);

        return {
            type: 'bbox',
            bboxString,
            wkt,
            geojson
        };
    }

    updateBboxPreview(e) {
        if (!this.isBboxDrawing || this.getCurrentMode() !== 'bbox') return;

        const bounds = [
            [Math.min(this.bboxStartLatLng.lat, e.latlng.lat), Math.min(this.bboxStartLatLng.lng, e.latlng.lng)],
            [Math.max(this.bboxStartLatLng.lat, e.latlng.lat), Math.max(this.bboxStartLatLng.lng, e.latlng.lng)]
        ];

        if (this.currentBboxLayer) {
            this.map.removeLayer(this.currentBboxLayer);
        }
        this.currentBboxLayer = L.rectangle(bounds, {
            color: '#007cff',
            weight: 2,
            fillOpacity: 0.1,
            dashArray: '5, 5'
        }).addTo(this.map);
    }

    updateModeInstructions() {
        const outputDiv = document.getElementById('quadkey-output');
        const zoomSection = document.querySelector('.zoom-section');
        const mode = this.getCurrentMode();

        if (mode === 'quadkey') {
            outputDiv.innerHTML = '<div class="instruction-text">Click on the map to get the quadkey</div>';
            zoomSection.classList.remove('hidden');
            this.clearBboxLayer();
        } else {
            outputDiv.innerHTML = '<div class="instruction-text">Click to start drawing a bounding box</div>';
            zoomSection.classList.add('hidden');
            this.clearQuadkeyLayer();
            this.resetBboxDrawing();
        }
    }

    clearBboxLayer() {
        if (this.currentBboxLayer) {
            this.map.removeLayer(this.currentBboxLayer);
            this.currentBboxLayer = null;
        }
    }

    clearQuadkeyLayer() {
        if (this.currentQuadkeyLayer) {
            this.map.removeLayer(this.currentQuadkeyLayer);
            this.currentQuadkeyLayer = null;
        }
    }

    resetBboxDrawing() {
        this.isBboxDrawing = false;
        this.bboxStartLatLng = null;
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.quadKeyApp = new QuadKeyApp();
});