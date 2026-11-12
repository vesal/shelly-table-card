class ShellyTableCard extends HTMLElement {
    setConfig(config) {
        this.config = config;
        const savedManufacturerFilter = localStorage.getItem(
            "shelly-table-manufacturer-filter"
        );

        const savedEnergyPeriod = localStorage.getItem(
            "shelly-table-energy-period"
        );

        this.energyPeriod = [
            "total", "1h", "6h", "24h", "7d", "30d"
        ].includes(savedEnergyPeriod)
            ? savedEnergyPeriod
            : "total";

        this.manufacturerFilter = savedManufacturerFilter !== null
            ? savedManufacturerFilter
            : String(config.manufacturer ?? "Shelly");
        this.filters = Array(7).fill("");
        this.sortColumn = -1;
        this.sortAscending = true;
        this.deviceRows = [];
        this.registryLoaded = false;
        this.registryLoading = false;
        this.registryError = "";
        this.filterErrors = {};
        this._hass = null;
        this._areas = {};
        this._devices = {};
        this._entities = [];
        this._loadGeneration = 0;
        this._lastStateSignature = "";
        this._renderedRows = new Map();
        this._renderedRowOrder = [];
        this._renderQueued = false;

        this.attachShadow({ mode: "open" });

        this.shadowRoot.innerHTML = `
            <style>
                ha-card {
                    padding: 12px;
                    overflow-x: auto;
                }

                .card-title {
                    font-size: 20px;
                    font-weight: 500;
                    margin-bottom: 12px;
                }

                .card-content {
                    min-width: 0;
                }

                table {
                    width: 100%;
                    border-collapse: collapse;
                    table-layout: fixed;
                    white-space: nowrap;
                    font-size: 14px;
                }

                th, td {
                    padding: 5px 6px;
                    text-align: left;
                    border-bottom: 1px solid var(--divider-color);
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                th:nth-child(1), td:nth-child(1) { width: 20%; }
                th:nth-child(2), td:nth-child(2) { width: 26%; }
                th:nth-child(3), td:nth-child(3) { width: 12%; }
                th:nth-child(4), td:nth-child(4) { width: 1%; }
                th:nth-child(5), td:nth-child(5) { width: 8%; }
                th:nth-child(6), td:nth-child(6) { width: 8%; }
                th:nth-child(7), td:nth-child(7) { width: 16%; }

                @media (max-width: 500px) {
                    th:nth-child(2), td:nth-child(2),
                    th:nth-child(3), td:nth-child(3),
                    th:nth-child(4), td:nth-child(4) {
                        display: none;
                    }
                    th:nth-child(1), td:nth-child(1) { width: 45%; }
                    th:nth-child(5), td:nth-child(5) { width: 20%; }
                    th:nth-child(6), td:nth-child(6) { width: 25%; }
                    th:nth-child(7), td:nth-child(7) { width: 10%; }
                }

                @media (max-width: 350px) {
                    th:nth-child(6), td:nth-child(6) {
                        display: none;
                    }
                }

                th {
                    cursor: pointer;
                    user-select: none;
                    font-weight: 600;
                }

                th.number, td.number {
                    text-align: right;
                }

                .xdevice-link {
                    display: block;
                    max-width: 100%;
                    padding: 0;
                    border: 0;
                    background: none;
                    color: var(--primary-color);
                    font: inherit;
                    text-align: left;
                    cursor: pointer;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    text-decoration: underline;
                    text-decoration-color: transparent;
                }


                .device-link, .history-link {
                    color: inherit;
                    text-decoration: underline;
                    text-decoration-color: transparent;
                }

                .device-link:hover, .history-link:hover {
                    color: var(--primary-color);
                    text-decoration-color: currentColor;
                    cursor: pointer;
                }

                .filter-cell {
                    padding: 3px 4px 7px;
                    cursor: default;
                }

                .filter-box {
                    display: flex;
                    align-items: center;
                    min-width: 55px;
                    border: 1px solid var(--divider-color);
                    border-radius: 4px;
                    background: var(--card-background-color);
                }

                .filter-box:focus-within {
                    border-color: var(--primary-color);
                }

                .filter-box.invalid {
                    border-color: var(--error-color, #db4437);
                }

                input {
                    box-sizing: border-box;
                    width: 100%;
                    min-width: 30px;
                    padding: 5px 4px;
                    border: 0;
                    outline: none;
                    background: transparent;
                    color: var(--primary-text-color);
                }

                .clear-filter {
                    flex: 0 0 auto;
                    border: 0;
                    padding: 2px 6px;
                    cursor: pointer;
                    background: transparent;
                    color: var(--secondary-text-color);
                    font-size: 17px;
                    line-height: 1;
                }

                .clear-filter:hover {
                    color: var(--primary-text-color);
                }

                button.control {
                    border: 1px solid var(--divider-color);
                    border-radius: 5px;
                    padding: 4px 9px;
                    cursor: pointer;
                    background: var(--secondary-background-color);
                    color: var(--primary-text-color);
                }

                button.control.on {
                    background: var(--success-color, #388e3c);
                    color: white;
                }

                button:disabled {
                    opacity: 0.5;
                    cursor: default;
                }

                .options {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px 18px;
                    margin: 8px 0 12px;
                    font-size: 13px;
                }

                .options label {
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                    cursor: pointer;
                }

                .options select {
                    padding: 4px 6px;
                    border: 1px solid var(--divider-color);
                    border-radius: 4px;
                    background: var(--card-background-color);
                    color: var(--primary-text-color);
                    font: inherit;
                }

                .manufacturer-label {
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                }

                .manufacturer-filter {
                    width: 140px;
                    min-width: 100px;
                    padding: 4px 6px;
                    border: 1px solid var(--divider-color);
                    border-radius: 4px;
                    background: var(--card-background-color);
                    color: var(--primary-text-color);
                    font: inherit;
                }

                .status {
                    color: var(--secondary-text-color);
                    font-size: 12px;
                    margin-top: 8px;
                }

                .summary {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px 18px;
                    margin: 8px 0 12px;
                    padding: 10px;
                    border: 1px solid var(--divider-color);
                    border-radius: 6px;
                    font-size: 13px;
                }

                .summary-item {
                    display: flex;
                    flex-direction: column;
                    gap: 3px;
                }

                .summary-label {
                    color: var(--secondary-text-color);
                    font-size: 12px;
                }

                .summary-value {
                    font-size: 16px;
                    font-weight: 500;
                }
                .filter-error {
                    color: var(--error-color, #db4437);
                    font-size: 12px;
                    margin-top: 5px;
                    white-space: normal;
                }

                .empty {
                    color: var(--secondary-text-color);
                    padding: 12px 8px;
                }

                .entity-details-button {
                    flex: 0 0 auto;
                    margin-left: 5px;
                    padding: 0 5px;
                    border: 1px solid var(--divider-color);
                    border-radius: 4px;
                    background: var(--secondary-background-color);
                    color: var(--primary-text-color);
                    cursor: pointer;
                    font-size: 16px;
                }

                .entity-details-button:hover {
                    background: var(--primary-color);
                    color: white;
                }

                .device-name-cell {
                    display: flex;
                    align-items: center;
                    min-width: 0;
                }

                .device-name-cell .device-link {
                    flex: 1 1 auto;
                    min-width: 0;
                }

                .entity-modal-backdrop {
                    position: fixed;
                    inset: 0;
                    z-index: 10000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 16px;
                    box-sizing: border-box;
                    background: rgba(0, 0, 0, 0.55);
                }

                .entity-modal {
                    width: min(760px, 100%);
                    max-height: 85vh;
                    overflow: auto;
                    padding: 18px;
                    box-sizing: border-box;
                    border-radius: 10px;
                    background: var(--card-background-color);
                    color: var(--primary-text-color);
                    box-shadow: var(--ha-card-box-shadow, 0 4px 16px #0005);
                    white-space: normal;
                }

                .entity-modal,
                .entity-modal * {
                    user-select: text;
                    -webkit-user-select: text;
                }

                .entity-modal-header {
                    display: flex;
                    align-items: flex-start;
                    justify-content: space-between;
                    gap: 12px;
                    margin-bottom: 12px;
                }

                .entity-modal-title {
                    margin: 0;
                    font-size: 20px;
                    font-weight: 500;
                    overflow-wrap: anywhere;
                }

                .entity-modal-close {
                    flex: 0 0 auto;
                    border: 0;
                    padding: 0 5px;
                    background: transparent;
                    color: var(--primary-text-color);
                    cursor: pointer;
                    font-size: 26px;
                    line-height: 1;
                }

                .entity-modal-info {
                    user-select: text;
                    -webkit-user-select: text;
                    margin-bottom: 10px;
                    color: var(--secondary-text-color);
                    font-size: 12px;
                }

                .entity-modal-options {
                    margin-bottom: 10px;
                    font-size: 13px;
                }

                .entity-modal-options label {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    cursor: pointer;
                }

                .entity-table-wrapper {
                    max-width: 100%;
                    overflow-x: auto;
                }

                .entity-table {
                    width: 100%;
                    border-collapse: collapse;
                    table-layout: auto;
                    white-space: nowrap;
                    font-size: 12px;
                }

                .entity-table th,
                .entity-table td {
                    padding: 4px 6px;
                    border-bottom: 1px solid var(--divider-color);
                    text-align: left;
                    vertical-align: middle;
                }

                .entity-table th {
                    font-weight: 600;
                    color: var(--secondary-text-color);
                }

                .entity-table .entity-id {
                    font-family: monospace;
                    font-size: 12px;
                }

                .entity-table .entity-state {
                    font-size: 12px;
                    overflow-wrap: anywhere;
                }

                .entity-table .unavailable {
                    color: var(--error-color, #db4437);
                }

                .entity-copy-button {
                    width: 25px;
                    height: 24px;
                    padding: 0;
                    border: 1px solid var(--divider-color);
                    border-radius: 4px;
                    background: var(--secondary-background-color);
                    color: var(--primary-text-color);
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 600;
                }

                .entity-copy-button:hover {
                    border-color: var(--primary-color);
                    color: var(--primary-color);
                }

                .entity-modal-footer {
                    display: flex;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: 8px;
                    margin-top: 12px;
                }

                .entity-modal-footer button {
                    border: 1px solid var(--divider-color);
                    border-radius: 5px;
                    padding: 5px 8px;
                    background: var(--secondary-background-color);
                    color: var(--primary-text-color);
                    cursor: pointer;
                    font-size: 12px;
                }

                .entity-copy-status {
                    flex: 1 1 100%;
                    min-height: 1.2em;
                    font-size: 12px;
                    color: var(--secondary-text-color);
                }

                @media (max-width: 500px) {
                    .entity-modal {
                        padding: 12px;
                    }

                    .entity-item {
                        grid-template-columns: minmax(0, 1fr);
                    }

                    .entity-buttons {
                        justify-content: flex-start;
                    }
                }

                .options label,
                .entity-modal-options label {
                    display: inline-flex;
                    flex-direction: row;
                    align-items: center;
                    justify-content: flex-start;
                    gap: 5px;
                    white-space: nowrap;
                    width: auto;
                }

                .options input[type="checkbox"],
                .entity-modal-options input[type="checkbox"] {
                    flex: 0 0 auto;
                    width: 16px;
                    min-width: 16px;
                    height: 16px;
                    margin: 0;
                    padding: 0;
                }

                .entity-modal-options {
                    display: flex;
                    align-items: center;
                    flex-wrap: nowrap;
                    margin-bottom: 10px;
                    white-space: nowrap;
                }

                .entity-modal-options label {
                    flex-wrap: nowrap;
                }
            </style>

            <ha-card>
                <div class="card-content">
                    <div class="card-title"></div>

                    <div class="options">
                        <label>
                            Energian aikaväli
                            <select data-energy-period>
                                <option value="total">Total</option>
                                <option value="1h">1 h</option>
                                <option value="6h">6 h</option>
                                <option value="24h">24 h</option>
                                <option value="7d">7 vrk</option>
                                <option value="30d">30 vrk</option>
                            </select>
                        </label>
                    </div>

                    <div class="summary">
                        <div class="summary-item">
                            <span class="summary-label">Hetkellinen summateho</span>
                            <span class="summary-value" data-summary="power">— W</span>
                        </div>

                        <div class="summary-item">
                            <span class="summary-label">Keskiteho aikavälillä</span>
                            <span class="summary-value" data-summary="average">— W</span>
                        </div>

                        <div class="summary-item">
                            <span class="summary-label">Energia aikavälillä</span>
                            <span class="summary-value" data-summary="energy">— kWh</span>
                        </div>
                    </div>

                    <div class="options">
                        <label>
                            <input type="checkbox" data-option="disabled">
                            poistetut
                        </label>
                        <label>
                            <input type="checkbox" data-option="offline">
                            offline
                        </label>
                        <label>
                            <input type="checkbox" data-option="noSwitch">
                            ei_kytkintä
                        </label>
                        <label class="manufacturer-label">
                            Valmistaja
                            <input
                                type="text"
                                class="manufacturer-filter"
                                data-manufacturer
                                title="Valmistajan RegExp-suodatin"
                            >
                        </label>
                    </div>

                    <table>
                        <thead>
                            <tr>
                                <th data-col="0">Laite ↕</th>
                                <th data-col="1">Nimi ↕</th>
                                <th data-col="2">Huone ↕</th>
                                <th data-col="3">Fyysinen laite ↕</th>
                                <th data-col="4" class="number">Teho (W) ↕</th>
                                <th data-col="5" class="number">Energia (kWh) ↕</th>
                                <th data-col="6">Kytkin ↕</th>
                            </tr>

                            <tr>
                                ${[
                                    "Laite...",
                                    "Nimi...",
                                    "Huone...",
                                    "Laite...",
                                    "Esim. >100",
                                    "Esim. <=0.5",
                                    "Tila..."
                                ].map((placeholder, index) => `
                                    <th class="filter-cell">
                                        <div class="filter-box">
                                            <input data-filter="${index}"
                                                placeholder="${placeholder}">
                                            <button class="clear-filter"
                                                data-clear="${index}"
                                                title="Tyhjennä suodatin"
                                                aria-label="Tyhjennä">×</button>
                                        </div>
                                    </th>
                                `).join("")}
                            </tr>
                        </thead>

                        <tbody></tbody>
                    </table>

                    <div class="filter-error" role="status"></div>
                    <div class="status">Haetaan laitteita...</div>
                </div>
            </ha-card>
        `;

        this.shadowRoot.querySelector(".card-title").textContent =
            config.title || "Shellyt";

        this.shadowRoot.querySelectorAll("[data-filter]").forEach(input => {
            input.addEventListener("input", event => {
                const col = Number(event.target.dataset.filter);
                this.filters[col] = event.target.value;
                this.renderRows();
            });
        });

        this.shadowRoot.querySelectorAll("[data-clear]").forEach(button => {
            button.addEventListener("click", event => {
                event.stopPropagation();

                const col = Number(button.dataset.clear);
                const input = this.shadowRoot.querySelector(
                    `[data-filter="${col}"]`
                );

                input.value = "";
                this.filters[col] = "";
                this.renderRows();
                input.focus();
            });
        });

        this.shadowRoot.querySelectorAll("[data-col]").forEach(header => {
            header.addEventListener("click", () => {
                const col = Number(header.dataset.col);

                if (this.sortColumn === col) {
                    this.sortAscending = !this.sortAscending;
                } else {
                    this.sortColumn = col;
                    this.sortAscending = true;
                }

                this.renderRows();
            });
        });

        this.shadowRoot.querySelectorAll("[data-option]").forEach(input => {
            input.addEventListener("change", () => {
                this.renderRows();
            });
        });

        const manufacturerInput =
            this.shadowRoot.querySelector("[data-manufacturer]");

        manufacturerInput.value = this.manufacturerFilter;

        manufacturerInput.addEventListener("input", () => {
            this.manufacturerFilter = manufacturerInput.value;

            localStorage.setItem(
                "shelly-table-manufacturer-filter",
                this.manufacturerFilter
            );

            this.registryError = "";
            this.renderRows();
        });

        const energyPeriodSelect =
            this.shadowRoot.querySelector("[data-energy-period]");

        energyPeriodSelect.value = this.energyPeriod;

        energyPeriodSelect.addEventListener("change", () => {
            this.energyPeriod = energyPeriodSelect.value;

            localStorage.setItem(
                "shelly-table-energy-period",
                this.energyPeriod
            );

            this.renderRows();
        });        
    }

    set hass(hass) {
        this._hass = hass;

        if (!this.registryLoaded && !this.registryLoading) {
            this.loadRegistry();
            return;
        }

        const signature = this.getStateSignature();

        if (signature !== this._lastStateSignature) {
            this._lastStateSignature = signature;
            this.renderRows();
        }

        this.updateEntityPopup();
    }

    getStateSignature() {
        if (!this._hass) {
            return "";
        }

        const ids = new Set();

        for (const device of this.deviceRows) {
            for (const entity of device.allEntities) {
                ids.add(entity.entity_id);
            }
        }

        return JSON.stringify(
            [...ids].sort().map(entityId => {
                const state = this._hass.states[entityId];

                if (!state) {
                    return [entityId, null];
                }

                return [
                    entityId,
                    state.state,
                    state.attributes?.friendly_name,
                    state.attributes?.unit_of_measurement,
                    state.attributes?.device_class,
                    state.attributes?.icon
                ];
            })
        );
    }

    getOption(name) {
        return Boolean(
            this.shadowRoot.querySelector(
                `[data-option="${name}"]`
            )?.checked
        );
    }

    escape(value) {
        return String(value).replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[char]);
    }

    makeRegExp(pattern) {
        try {
            return {
                regex: new RegExp(pattern, "i"),
                error: ""
            };
        } catch (error) {
            return {
                regex: null,
                error: error.message || "Virheellinen säännöllinen lauseke"
            };
        }
    }

    matchesManufacturer(manufacturer) {
        const pattern = String(this.config.manufacturer ?? "Shelly");

        if (!pattern) {
            return true;
        }

        const result = this.makeRegExp(pattern);

        if (!result.regex) {
            this.registryError =
                `Valmistajan RegExp on virheellinen: ${result.error}`;
            return false;
        }

        return result.regex.test(String(manufacturer || ""));
    }

    async loadRegistry() {
        if (!this._hass || this.registryLoading) {
            return;
        }

        this.registryLoading = true;
        this.registryError = "";
        const generation = ++this._loadGeneration;
        this.renderRows();

        try {
            const [devices, entities, areas] = await Promise.all([
                this._hass.callWS({
                    type: "config/device_registry/list"
                }),
                this._hass.callWS({
                    type: "config/entity_registry/list"
                }),
                this._hass.callWS({
                    type: "config/area_registry/list"
                })
            ]);

            if (generation !== this._loadGeneration) {
                return;
            }

            this._areas = Object.fromEntries(
                areas.map(area => [area.area_id, area.name])
            );

            this._devices = Object.fromEntries(
                devices.map(device => [device.id, device])
            );

            this._entities = entities;

            this.deviceRows = devices.map(device => {
                const deviceEntities = entities.filter(entity =>
                    entity.device_id === device.id
                );

                const powers = deviceEntities.filter(entity =>
                    this.isPowerEntity(entity)
                );

                const energies = deviceEntities.filter(entity =>
                    this.isEnergyEntity(entity) &&
                    !this.isReturnedEnergy(entity)
                );

                const controls = deviceEntities.filter(entity =>
                    ["switch", "light"].includes(
                        entity.entity_id.split(".")[0]
                    )
                );

                const parentDevice = device.via_device_id
                    ? this._devices[device.via_device_id]
                    : null;

                return {
                    id: device.id,
                    technicalName: device.name || device.id,
                    friendlyName: device.name_by_user || "",
                    area: this._areas[device.area_id] || "",
                    manufacturer: device.manufacturer || "",
                    model: device.model || "",
                    parentId: parentDevice?.id || "",
                    physicalDevice: parentDevice
                        ? (parentDevice.name || parentDevice.id)
                        : "",
                    powerEntities: powers,
                    energyEntities: energies,
                    controlEntities: controls,
                    allEntities: deviceEntities
                };
            }).filter(device => device.allEntities.length > 0);

            this.registryLoaded = true;
        } catch (error) {
            console.error(
                "Shellyt: laitteiden haku epäonnistui",
                error
            );

            this.registryError =
                "Laiterekisterin haku epäonnistui. Tarkista selaimen konsoli ja käyttöoikeudet.";
        } finally {
            this.registryLoading = false;
            this._lastStateSignature = this.getStateSignature();
            this.renderRows();
        }
    }

    isPowerEntity(entity) {
        const state = this._hass.states[entity.entity_id];
        const attrs = state?.attributes || {};
        const unit = String(
            attrs.unit_of_measurement || ""
        ).toLowerCase();

        return attrs.device_class === "power" ||
            ["w", "kw"].includes(unit);
    }

    isEnergyEntity(entity) {
        const state = this._hass.states[entity.entity_id];
        const attrs = state?.attributes || {};
        const unit = String(
            attrs.unit_of_measurement || ""
        ).toLowerCase();

        return attrs.device_class === "energy" ||
            ["wh", "kwh", "mwh"].includes(unit);
    }

    isReturnedEnergy(item) {
        const state = this._hass.states[item.entity_id];
        const text = [
            item.entity_id,
            item.original_name,
            item.name,
            state?.attributes?.friendly_name
        ].filter(Boolean).join(" ").toLowerCase();

        return /returned|palautettu|palautus|vienti/.test(text);
    }

    entityIsDisabled(entity) {
        return Boolean(entity.disabled_by);
    }

    getUsableEntities(entities) {
        const showDisabled = this.getOption("disabled");

        return entities.filter(entity => {
            if (showDisabled) {
                return true;
            }

            return !this.entityIsDisabled(entity) && !entity.hidden_by;
        });
    }

    getDeviceMac(device) {
        const connection = (device.connections || [])
            .find(item => item[0] === "mac");

        return connection
            ? connection[1].toUpperCase()
            : "Ei tiedossa";
    }

    getDeviceIp(device) {
        if (!device.configuration_url) {
            return "Ei tiedossa";
        }

        try {
            const url = new URL(device.configuration_url);
            const host = url.hostname;

            // Hyväksytään IPv4- ja IPv6-osoitteet.
            const isIp = /^[\d.]+$/.test(host) ||
                (host.includes(":") && /^[0-9a-f:]+$/i.test(host));

            return isIp ? host : "Ei tiedossa";
        } catch (error) {
            return "Ei tiedossa";
        }
    }

    async getInventoryIp(device) {
        const connection = (device.connections || [])
            .find(item => item[0] === "mac");
        const mac = connection?.[1]?.replace(/[^0-9a-f]/gi, "").toLowerCase();
        if (!mac || !/^[0-9a-f]{12}$/.test(mac)) {
            return null;
        }

        const result = await this._hass.callApi("GET", "macip");
        if (typeof result.content !== "string") {
            throw new Error("Laiteluettelo ei sisällä tekstiä.");
        }
        const lines = result.content.replace(/^\uFEFF/, "").split(/\r?\n/);
        const header = lines.shift()?.split("|").map(value => value.trim());
        const macColumn = header?.indexOf("MAC") ?? -1;
        const ipColumn = header?.indexOf("IP") ?? -1;
        if (macColumn < 0 || ipColumn < 0) {
            throw new Error("Laiteluettelosta puuttuu MAC- tai IP-sarake.");
        }

        for (const line of lines) {
            if (!line.trim()) continue;
            const columns = line.split("|").map(value => value.trim());
            if (columns.length !== header.length) {
                throw new Error("Laiteluettelossa on virheellinen rivi.");
            }
            if (columns[macColumn].replace(/[^0-9a-f]/gi, "").toLowerCase() !== mac) {
                continue;
            }
            const ip = columns[ipColumn];
            const parts = ip.split(".");
            if (parts.length === 4 && parts.every(part =>
                /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255
            ) && ip !== "192.168.59.255") {
                return ip;
            }
            if (ip.includes(":")) {
                try {
                    return new URL(`http://[${ip}]/`).hostname;
                } catch {
                    return null;
                }
            }
            return null;
        }
        return null;
    }
    
    chooseEntity(entities, preferredDomain = null) {
        const candidates = this.getUsableEntities(entities)
            .map(entity => ({
                entity,
                state: this._hass.states[entity.entity_id]
            }))
            .filter(item => item.state);

        if (!candidates.length) {
            return null;
        }

        candidates.sort((a, b) => {
            const aDomain = a.entity.entity_id.split(".")[0];
            const bDomain = b.entity.entity_id.split(".")[0];

            if (preferredDomain) {
                if (
                    aDomain === preferredDomain &&
                    bDomain !== preferredDomain
                ) {
                    return -1;
                }

                if (
                    bDomain === preferredDomain &&
                    aDomain !== preferredDomain
                ) {
                    return 1;
                }
            }

            return a.entity.entity_id.localeCompare(
                b.entity.entity_id,
                "fi",
                { numeric: true }
            );
        });

        return candidates[0];
    }

    numericState(item, kind) {
        if (!item?.state) {
            return null;
        }

        const state = item.state;

        if (["unknown", "unavailable"].includes(state.state)) {
            return null;
        }

        let value = Number(state.state);

        if (!Number.isFinite(value)) {
            return null;
        }

        const unit = String(
            state.attributes?.unit_of_measurement || ""
        ).toLowerCase();

        if (kind === "power" && unit === "kw") {
            value *= 1000;
        }

        if (kind === "energy") {
            if (unit === "wh") {
                value /= 1000;
            }

            if (unit === "mwh") {
                value *= 1000;
            }
        }

        return value;
    }

    formatNumber(value) {
        if (value === null || value === undefined) {
            return "—";
        }

        return value.toFixed(1);
    }

    updateSummary(rows) {
        const powerElement =
            this.shadowRoot.querySelector('[data-summary="power"]');

        const averageElement =
            this.shadowRoot.querySelector('[data-summary="average"]');

        const energyElement =
            this.shadowRoot.querySelector('[data-summary="energy"]');

        const powers = rows
            .map(row => row.power)
            .filter(value =>
                typeof value === "number" && Number.isFinite(value)
            );

        const totalPower = powers.reduce(
            (sum, value) => sum + value,
            0
        );

        powerElement.textContent = `${totalPower.toFixed(1)} W`;

        this.updateEnergySummary(rows);
    }

    parseComparisonFilter(filter) {
        const match = String(filter).trim().match(
            /^(>=|<=|!=|==|>|<|=)\s*(-?(?:\d+(?:[.,]\d*)?|[.,]\d+))$/
        );

        if (!match) {
            return null;
        }

        return {
            operator: match[1],
            value: Number(match[2].replace(",", "."))
        };
    }

    compareNumber(value, operator, target) {
        if (value === null || value === undefined) {
            return false;
        }

        switch (operator) {
            case ">":
                return value > target;
            case "<":
                return value < target;
            case ">=":
                return value >= target;
            case "<=":
                return value <= target;
            case "=":
            case "==":
                return value === target;
            case "!=":
                return value !== target;
            default:
                return false;
        }
    }

    matchesFilter(value, filter, numericColumn) {
        if (!filter) {
            return true;
        }

        if (numericColumn) {
            const comparison = this.parseComparisonFilter(filter);

            if (comparison) {
                return this.compareNumber(
                    typeof value === "number" ? value : null,
                    comparison.operator,
                    comparison.value
                );
            }
        }

        const result = this.makeRegExp(filter);

        if (!result.regex) {
            return true;
        }

        return result.regex.test(String(value ?? ""));
    }

    rowValues(row) {
        return [
            row.technicalName,
            row.friendlyName || "—",
            row.area || "—",
            row.physicalDevice || "—",
            row.power,
            row.energy,
            row.controlState
        ];
    }

    getRowsForDisplay() {
        return this.deviceRows.map(device => {
            const powerItem = this.chooseEntity(device.powerEntities);
            const energyItem = this.chooseEntity(device.energyEntities);
            const controlItem = this.chooseEntity(
                device.controlEntities,
                "switch"
            );

            const power = this.numericState(powerItem, "power");
            const energy = this.numericState(energyItem, "energy");
            const controlState = controlItem?.state?.state || "—";

            const relevantItems = [
                powerItem,
                energyItem,
                controlItem
            ].filter(Boolean);

            const allUnavailable = relevantItems.length > 0 &&
                relevantItems.every(item =>
                    ["unavailable", "unknown"].includes(item.state.state)
                );

            const hasEnabledEntity = device.allEntities.some(entity =>
                !entity.disabled_by && !entity.hidden_by
            );

            return {
                ...device,
                power,
                energy,
                powerEntity: powerItem?.entity.entity_id || null,
                energyEntity: energyItem?.entity.entity_id || null,
                controlEntity: controlItem?.entity.entity_id || null,
                controlState,
                allUnavailable,
                hasEnabledEntity,
                hasControl: Boolean(controlItem)
            };
        });
    }

    getHistoryUrl(entityId) {
        const now = new Date();
        const period = this.energyPeriod || "total";

        let start;
        let end;

        if (period === "total") {
            // Kolme kalenterivuorokautta: kaksi edellistä ja kuluva.
            start = new Date(now);
            start.setHours(0, 0, 0, 0);
            start.setDate(start.getDate() - 2);

            end = new Date(start);
            end.setDate(end.getDate() + 3);
            end.setMilliseconds(-1);

        } else if (period === "1h") {
            // Yksi kokonainen mennyt tunti ja nykyinen keskeneräinen tunti.
            start = new Date(now);
            start.setMinutes(0, 0, 0);
            start.setHours(start.getHours() - 1);

            end = new Date(start);
            end.setHours(end.getHours() + 2);
        } else if (period === "6h") {
            start = new Date(now);
            start.setMinutes(0, 0, 0);
            start.setHours(start.getHours() - 6);

            end = new Date(now);
            end.setMinutes(0, 0, 0);
            end.setHours(end.getHours() + 1);
        } else if (period === "24h") {
            start = new Date(now);
            start.setHours(0, 0, 0, 0);
            start.setDate(start.getDate() - 1);

            end = new Date(start);
            end.setDate(end.getDate() + 2);

        } else if (period === "7d") {
            start = new Date(now);
            start.setHours(0, 0, 0, 0);
            start.setDate(start.getDate() - 7);

            end = new Date(start);
            end.setDate(end.getDate() + 8);
        } else if (period === "30d") {
            start = new Date(now);
            start.setHours(0, 0, 0, 0);
            start.setDate(start.getDate() - 30);

            end = new Date(start);
            end.setDate(end.getDate() + 31);
        }

        const params = new URLSearchParams({
            entity_id: entityId,
            start_date: start.toISOString(),
            end_date: end.toISOString()
        });

        return `/history?${params.toString()}`;
    }
    
    async getEnergyHistory(entityIds, startTime, endTime) {
        if (!entityIds.length) {
            return [];
        }

        const start = encodeURIComponent(startTime.toISOString());
        const end = encodeURIComponent(endTime.toISOString());
        const ids = encodeURIComponent(entityIds.join(","));

        const url =
            `history/period/${start}` +
            `?end_time=${end}` +
            `&filter_entity_id=${ids}` +
            `&minimal_response&no_attributes`;

        return await this._hass.callApi("GET",  url);
    }
    
    async updateEnergySummary(rows) {
        const averageElement =
            this.shadowRoot.querySelector('[data-summary="average"]');

        const energyElement =
            this.shadowRoot.querySelector('[data-summary="energy"]');

        const period = this.energyPeriod;

        const durations = {
            "1h": 60 * 60 * 1000,
            "6h": 6 * 60 * 60 * 1000,
            "24h": 24 * 60 * 60 * 1000,
            "7d": 7 * 24 * 60 * 60 * 1000,
            "30d": 30 * 24 * 60 * 60 * 1000
        };

        if (!durations[period]) {
            averageElement.textContent = "Ei laskettavissa";
            energyElement.textContent = "Ei laskettavissa";
            return;
        }

        const endTime = new Date();
        const startTime = new Date(
            endTime.getTime() - durations[period]
        );

        const entityIds = [...new Set(
            rows
                .map(row => row.energyEntity)
                .filter(Boolean)
        )];

        if (!entityIds.length) {
            averageElement.textContent = "— W";
            energyElement.textContent = "— kWh";
            return;
        }

        try {
            const history = await this.getEnergyHistory(
                entityIds,
                startTime,
                endTime
            );

            let totalEnergy = 0;

            for (const states of history) {
                if (!states || states.length < 2) {
                    continue;
                }

                const firstState = states[0];
                const lastState = states[states.length - 1];

                const firstRaw = Number(firstState.state);
                const lastRaw = Number(lastState.state);

                const unit = (
                    this._hass.states[firstState.entity_id]?.attributes?.unit_of_measurement ||
                    this._hass.states[lastState.entity_id]?.attributes?.unit_of_measurement ||
                    "kWh"
                ).toLowerCase();

                const factor = unit === "wh"
                    ? 0.001
                    : unit === "mwh"
                        ? 1000
                        : 1;

                const first = firstRaw * factor;
                const last = lastRaw * factor;

                if (
                    !Number.isFinite(first) ||
                    !Number.isFinite(last) ||
                    last < first
                ) {
                    continue;
                }

                totalEnergy += last - first;
            }

            const elapsedHours =
                (endTime.getTime() - startTime.getTime()) /
                (60 * 60 * 1000);

            energyElement.textContent =
                `${totalEnergy.toFixed(3)} kWh`;

            averageElement.textContent =
                `${(totalEnergy / elapsedHours * 1000).toFixed(1)} W`;
        } catch (error) {
            console.error(
                "Shelly-table-card: energiahistorian haku epäonnistui",
                error
            );

            averageElement.textContent = "Virhe";
            energyElement.textContent = "Virhe";
        }
    }

    openDevice(deviceId) {
        const path =
            `/config/devices/device/${encodeURIComponent(deviceId)}`;

        history.pushState(null, "", path);
        window.dispatchEvent(new Event("location-changed"));
    }

    async copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (error) {
            const textarea = document.createElement("textarea");

            textarea.value = text;
            textarea.style.position = "fixed";
            textarea.style.left = "-9999px";
            textarea.style.top = "0";

            this.shadowRoot.appendChild(textarea);
            textarea.select();

            let success = false;

            try {
                success = document.execCommand("copy");
            } catch (copyError) {
                console.error("Kopiointi epäonnistui", copyError);
            }

            textarea.remove();
            return success;
        }
    }

    async copyEntityId(entityId, statusElement) {
        const success = await this.copyText(entityId);

        statusElement.textContent = success
            ? `Kopioitu: ${entityId}`
            : "Kopiointi epäonnistui.";
    }

    getEntityYaml(entity) {
        const domain = entity.entity_id.split(".")[0];

        if (["switch", "light"].includes(domain)) {
            return [
                "- action: homeassistant.toggle",
                "  target:",
                `    entity_id: ${entity.entity_id}`
            ].join("\n");
        }

        return [
            "# Entiteetin tunnus",
            `entity_id: ${entity.entity_id}`
        ].join("\n");
    }

    async copyEntityYaml(entity, statusElement) {
        const yaml = this.getEntityYaml(entity);
        const success = await this.copyText(yaml);

        statusElement.textContent = success
            ? `YAML kopioitu: ${entity.entity_id}`
            : "YAML-kopiointi epäonnistui.";
    }

    async copyDeviceEntitiesYaml(device, statusElement) {
        const entities = [...device.allEntities].sort((a, b) =>
            a.entity_id.localeCompare(b.entity_id, "fi", {
                numeric: true
            })
        );

        const yaml = entities.map(entity =>
            `- entity_id: ${entity.entity_id}`
        ).join("\n");

        const success = await this.copyText(yaml);

        statusElement.textContent = success
            ? `${entities.length} entiteetin tunnukset kopioitu YAML-muodossa.`
            : "YAML-kopiointi epäonnistui.";
    }

    openEntityPopup(device) {
        this.closeEntityPopup();

        const backdrop = document.createElement("div");
        backdrop.className = "entity-modal-backdrop";

        const modal = document.createElement("section");
        modal.className = "entity-modal";
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute(
            "aria-label",
            `Laitteen ${device.technicalName} entiteetit`
        );

        const header = document.createElement("div");
        header.className = "entity-modal-header";

        const title = document.createElement("h2");
        title.className = "entity-modal-title";
        title.textContent = device.technicalName + this.escape(" - " + device.friendlyName || "")

        const closeButton = document.createElement("button");
        closeButton.className = "entity-modal-close";
        closeButton.textContent = "×";
        closeButton.title = "Sulje";
        closeButton.setAttribute(
            "aria-label",
            "Sulje ponnahdusikkuna"
        );
        closeButton.addEventListener(
            "click",
            () => this.closeEntityPopup()
        );

        header.append(title, closeButton);
        modal.appendChild(header);

        const deviceLink = document.createElement("a");
        deviceLink.href =
            `/config/devices/device/${encodeURIComponent(device.id)}`;
        deviceLink.textContent =
            "Avaa Home Assistantin laitesivu";
        deviceLink.target = "_self";
        deviceLink.style.display = "inline-block";
        deviceLink.style.marginBottom = "12px";
        deviceLink.style.color = "var(--primary-color)";
        deviceLink.style.textDecoration = "underline";

        deviceLink.addEventListener("click", event => {
            event.preventDefault();
            this.closeEntityPopup();
            this.openDevice(device.id);
        });

        modal.appendChild(deviceLink);

        const networkInfo = document.createElement("div");
        networkInfo.className = "entity-modal-info";

        const registryDevice = this._devices[device.id];
        networkInfo.innerHTML = `
            <span><strong>MAC:</strong> ${this.escape(this.getDeviceMac(registryDevice))}</span>
            <span><strong>IP:</strong> <span class="device-ip"></span></span>
        `;
        const ipElement = networkInfo.querySelector(".device-ip");
        const showIp = ip => {
            ipElement.replaceChildren();
            if (!ip) {
                ipElement.textContent = "Ei tiedossa";
                return;
            }
            const link = document.createElement("a");
            link.href = `http://${ip}`;
            link.target = "_blank";
            link.rel = "noopener";
            link.textContent = ip;
            ipElement.append(link);
        };
        const haIp = this.getDeviceIp(registryDevice);
        showIp(haIp === "Ei tiedossa" ? null : haIp);
        if (haIp === "Ei tiedossa") {
            this.getInventoryIp(registryDevice).then(ip => {
                showIp(ip);
            }).catch(error => {
                console.error("IP-osoitteen haku laiteluettelosta epäonnistui", error);
                ipElement.textContent = "Laiteluettelon haku epäonnistui";
            });
        }

        modal.appendChild(networkInfo);
        
        const info = document.createElement("div");
        info.className = "entity-modal-info";
        info.textContent =
            `${device.allEntities.length} entiteettiä · ` +
            `${device.manufacturer || "Valmistaja tuntematon"}` +
            (device.model ? ` · ${device.model}` : "");

        modal.appendChild(info);

        const options = document.createElement("div");
        options.className = "entity-modal-options";

        const unavailableLabel = document.createElement("label");
        const unavailableCheckbox = document.createElement("input");
        unavailableCheckbox.type = "checkbox";
        unavailableCheckbox.checked = false;

        unavailableLabel.append(
            unavailableCheckbox,
            document.createTextNode('Näytä myös "ei saatavilla"')
        );

        options.appendChild(unavailableLabel);
        modal.appendChild(options);

        const tableWrapper = document.createElement("div");
        tableWrapper.className = "entity-table-wrapper";
/*
        this.summaryElement = document.createElement("div");
        this.summaryElement.className = "summary";
        this.summaryElement.textContent = "Lasketaan summia...";
        this.content.appendChild(this.summaryElement);
*/
        const table = document.createElement("table");
        table.className = "entity-table";

        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");

        ["Entiteetti", "Tila", "T", "Y"].forEach(text => {
            const th = document.createElement("th");
            th.textContent = text;
            headerRow.appendChild(th);
        });

        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        const copyStatus = document.createElement("div");
        copyStatus.className = "entity-copy-status";
        copyStatus.setAttribute("role", "status");

        const entities = [...device.allEntities].sort((a, b) =>
            a.entity_id.localeCompare(b.entity_id, "fi", {
                numeric: true
            })
        );

        const entityRows = entities.map(entity => {
            const tr = document.createElement("tr");

            const idCell = document.createElement("td");
            idCell.className = "entity-id";
            idCell.textContent = entity.entity_id;

            const stateCell = document.createElement("td");
            stateCell.className = "entity-state";

            const copyIdCell = document.createElement("td");
            const copyIdButton = document.createElement("button");
            copyIdButton.className = "entity-copy-button";
            copyIdButton.textContent = "T";
            copyIdButton.title = "Kopioi entiteetin tunnus";
            copyIdButton.addEventListener("click", () => {
                this.copyEntityId(entity.entity_id, copyStatus);
            });
            copyIdCell.appendChild(copyIdButton);

            const copyYamlCell = document.createElement("td");
            const copyYamlButton = document.createElement("button");
            copyYamlButton.className = "entity-copy-button";
            copyYamlButton.textContent = "Y";
            copyYamlButton.title = "Kopioi YAML-esimerkki";
            copyYamlButton.addEventListener("click", () => {
                this.copyEntityYaml(entity, copyStatus);
            });
            copyYamlCell.appendChild(copyYamlButton);

            tr.append(idCell, stateCell, copyIdCell, copyYamlCell);

            return {
                tr,
                entity,
                idCell,
                stateCell,
                unavailable: true
            };
        });

        entityRows.forEach(item => tbody.appendChild(item.tr));

        table.appendChild(tbody);
        tableWrapper.appendChild(table);
        modal.appendChild(tableWrapper);

        unavailableCheckbox.addEventListener("change", () => {
            entityRows.forEach(item => {
                item.tr.hidden =
                    !unavailableCheckbox.checked && item.unavailable;
            });
        });

        const footer = document.createElement("div");
        footer.className = "entity-modal-footer";

        const copyAllButton = document.createElement("button");
        copyAllButton.textContent =
            "Kopioi kaikki tunnukset YAML-muodossa";
        copyAllButton.addEventListener("click", () => {
            this.copyDeviceEntitiesYaml(device, copyStatus);
        });

        footer.append(copyAllButton, copyStatus);
        modal.appendChild(footer);

        backdrop.appendChild(modal);

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) {
                this.closeEntityPopup();
            }
        });

        this._entityPopupKeyHandler = event => {
            if (event.key === "Escape") {
                this.closeEntityPopup();
            }
        };

        document.addEventListener(
            "keydown",
            this._entityPopupKeyHandler
        );

        this.shadowRoot.appendChild(backdrop);
        this._entityPopup = backdrop;
        this._entityPopupRows = entityRows;
        this._entityPopupDevice = device;
        this._entityPopupUnavailableCheckbox = unavailableCheckbox;

        this.updateEntityPopup();
        closeButton.focus();
    }

    updateEntityPopup() {
        if (!this._entityPopupRows || !this._hass) {
            return;
        }

        for (const item of this._entityPopupRows) {
            const state = this._hass.states[item.entity.entity_id];
            const unavailable = !state ||
                ["unknown", "unavailable"].includes(state.state);

            const unit = state?.attributes?.unit_of_measurement;

            item.idCell.title =
                state?.attributes?.friendly_name ||
                item.entity.name ||
                item.entity.original_name ||
                item.entity.entity_id;

            const unitDecimals = {
                "kWh": 3,
                "Wh": 1,
                "kW": 3,
                "W": 1,
                "dBm": 0,
                "°C": 2,
                "%": 1,
                "V": 1,
                "A": 2,
                "mA": 0,
                "Hz": 0,
                "kHz": 1,
                "MB": 1,
                "GB": 2
            };            

            const decimals = unitDecimals[unit] ?? 2;

            const stateText = state
                ? Number.isFinite(Number(state.state))
                    ? Number(state.state).toFixed(decimals) +
                    (unit ? ` ${unit}` : "")
                    : state.state
                : "-";

            if (item.stateCell.textContent !== stateText) {
                item.stateCell.textContent = stateText;
            }

            item.stateCell.classList.toggle(
                "unavailable",
                unavailable
            );

            item.unavailable = unavailable;
            item.tr.hidden =
                !this._entityPopupUnavailableCheckbox.checked &&
                unavailable;
        }
    }

    closeEntityPopup() {
        if (this._entityPopup) {
            this._entityPopup.remove();
            this._entityPopup = null;
        }

        this._entityPopupRows = null;
        this._entityPopupDevice = null;
        this._entityPopupUnavailableCheckbox = null;

        if (this._entityPopupKeyHandler) {
            document.removeEventListener(
                "keydown",
                this._entityPopupKeyHandler
            );
            this._entityPopupKeyHandler = null;
        }
    }

    createRowElements(row) {
        const tr = document.createElement("tr");
        const cells = [];

        for (let i = 0; i < 7; i++) {
            const td = document.createElement("td");
            tr.appendChild(td);
            cells.push(td);
        }

        const nameContainer = document.createElement("div");
        nameContainer.className = "device-name-cell";

        const nameButton = document.createElement("a");
        nameButton.className = "device-link";


        nameButton.addEventListener("click", () => {
            const currentRow = tr._currentRow;
            if (currentRow) {
                this.openEntityPopup(currentRow);
            }
        });
        
        nameContainer.appendChild(nameButton);
        cells[0].appendChild(nameContainer);

        const controlButton = document.createElement("button");
        controlButton.className = "control";
        controlButton.type = "button";

        controlButton.addEventListener("click", async event => {
            event.preventDefault();
            event.stopPropagation();

            if (controlButton.disabled) {
                return;
            }

            const entityId = tr._currentRow?.controlEntity;
            if (!entityId) {
                return;
            }

            const friendlyName = tr._currentRow?.friendlyName || "";

            if (friendlyName.includes("!")) {
                const confirmed = window.confirm(
                    `Laitteen nimessä on huutomerkki:\n\n` +
                    `${friendlyName}\n\n` +
                    `Haluatko varmasti vaihtaa kytkimen tilaa?`
                );

                if (!confirmed) {
                    return;
                }
            }

            const entityState = this._hass.states[entityId];

            if (
                !entityState ||
                ["unavailable", "unknown"].includes(entityState.state)
            ) {
                console.warn(
                    "[Shellyt] Entiteetti ei ole käytettävissä:",
                    entityId
                );
                return;
            }

            const domain = entityId.split(".")[0];
            if (!["switch", "light"].includes(domain)) {
                console.error(
                    "[Shellyt] Ohjausta ei tueta:",
                    entityId
                );
                return;
            }

            const service = entityState.state === "on"
                ? "turn_off"
                : "turn_on";

            controlButton.disabled = true;

            try {
                await this._hass.callService(domain, service, {
                    entity_id: entityId
                });
            } catch (error) {
                console.error(
                    "[Shellyt] Ohjaus epäonnistui:",
                    entityId,
                    error
                );
            } finally {
                window.setTimeout(() => {
                    controlButton.disabled = false;
                }, 700);
            }
        });

        cells[6].appendChild(controlButton);

        return {
            tr,
            cells,
            nameButton,
            controlButton
        };
    }

    updateRowElements(elements, row) {
        const {
            tr,
            cells,
            nameButton,
            controlButton
        } = elements;

        tr._currentRow = row;
        tr._deviceId = row.id;

        nameButton.textContent = row.technicalName;
        nameButton.title =
            "Avaa laitteen tiedot Home Assistantissa";

        cells[1].textContent = row.friendlyName || "—";
        cells[2].textContent = row.area || "—";
        cells[3].textContent = row.physicalDevice || "—";
        cells[3].title = row.physicalDevice || "";

        cells[4].className = "number";

        if (row.powerEntity && row.power !== null) {
            let powerLink = cells[4].querySelector("a.history-link");

            if (!powerLink) {
                powerLink = document.createElement("a");
                powerLink.className = "history-link";
                cells[4].replaceChildren(powerLink);
            }

            const powerText = this.formatNumber(row.power);
            const powerUrl = this.getHistoryUrl(row.powerEntity);
            const powerTitle =
                `Avaa entiteetin ${row.powerEntity} historia`;

            if (powerLink.href !== new URL(powerUrl, location.href).href) {
                powerLink.href = powerUrl;
            }
            if (powerLink.textContent !== powerText) {
                powerLink.textContent = powerText;
            }
            if (powerLink.title !== powerTitle) {
                powerLink.title = powerTitle;
            }
        } else {
            cells[4].textContent = this.formatNumber(row.power);
        }

        cells[5].className = "number";

        if (row.energyEntity && row.energy !== null) {
            let energyLink = cells[5].querySelector("a.history-link");

            if (!energyLink) {
                energyLink = document.createElement("a");
                energyLink.className = "history-link";
                cells[5].replaceChildren(energyLink);
            }

            const energyText = this.formatNumber(row.energy);
            const energyUrl = this.getHistoryUrl(row.energyEntity);
            const energyTitle =
                `Avaa entiteetin ${row.energyEntity} historia`;

            if (energyLink.href !== new URL(energyUrl, location.href).href) {
                energyLink.href = energyUrl;
            }
            if (energyLink.textContent !== energyText) {
                energyLink.textContent = energyText;
            }
            if (energyLink.title !== energyTitle) {
                energyLink.title = energyTitle;
            }
        } else {
            cells[5].textContent = this.formatNumber(row.energy);
        }
        if (!row.controlEntity) {
            controlButton.hidden = true;
            cells[6].textContent = "—";
            return;
        }

        const entityState = this._hass.states[row.controlEntity];

        if (
            !entityState ||
            ["unavailable", "unknown"].includes(entityState.state)
        ) {
            controlButton.hidden = true;
            cells[6].textContent = "Ei käytettävissä";
            return;
        }

        if (cells[6].firstChild !== controlButton) {
            cells[6].replaceChildren(controlButton);
        }

        controlButton.hidden = false;
        controlButton.textContent =
            entityState.state === "on" ? "ON" : "OFF";
        controlButton.classList.toggle(
            "on",
            entityState.state === "on"
        );
        controlButton.title =
            `Ohjaa entiteettiä ${row.controlEntity}`;
        controlButton.setAttribute(
            "aria-label",
            `${row.technicalName}: ${controlButton.textContent}`
        );
    }

    renderRows() {
        if (!this._hass || !this.shadowRoot.querySelector("tbody")) {
            return;
        }

        const tbody = this.shadowRoot.querySelector("tbody");
        const errorElement = this.shadowRoot.querySelector(".filter-error");
        const status = this.shadowRoot.querySelector(".status");
        const manufacturerResult = this.makeRegExp(
            this.manufacturerFilter ?? "Shelly"
        );

        const allRows = manufacturerResult.regex
            ? this.getRowsForDisplay().filter(row =>
                manufacturerResult.regex.test(row.manufacturer || "")
            )
            : [];

        let rows = allRows.filter(row => {
            if (!this.getOption("disabled") && !row.hasEnabledEntity) {
                return false;
            }

            if (!this.getOption("offline") && row.allUnavailable) {
                return false;
            }

            if (
                !this.getOption("noSwitch") &&
                !row.hasControl &&
                row.power === null &&
                row.energy === null
            ) {
                return false;
            }

            return true;
        });

        const filterErrors = [];

        rows = rows.filter(row => {
            const values = this.rowValues(row);

            return values.every((value, index) => {
                const filter = this.filters[index];

                if (!filter) {
                    return true;
                }

                const numericColumn = index === 4 || index === 5;

                if (
                    numericColumn &&
                    this.parseComparisonFilter(filter)
                ) {
                    return this.matchesFilter(value, filter, true);
                }

                const result = this.makeRegExp(filter);

                if (!result.regex) {
                    filterErrors.push(
                        `Sarake "${[
                            "Laite",
                            "Nimi",
                            "Huone",
                            "Fyysinen laite",
                            "Teho",
                            "Energia",
                            "Kytkin"
                        ][index]}": ${result.error}`
                    );

                    return true;
                }

                return result.regex.test(String(value ?? ""));
            });
        });

        if (this.sortColumn >= 0) {
            const col = this.sortColumn;
            const direction = this.sortAscending ? 1 : -1;

            rows.sort((a, b) => {
                const av = this.rowValues(a)[col];
                const bv = this.rowValues(b)[col];

                if (typeof av === "number" && typeof bv === "number") {
                    return direction * (av - bv);
                }

                return direction * String(av ?? "").localeCompare(
                    String(bv ?? ""),
                    "fi",
                    { numeric: true }
                );
            });
        }

        this.updateSummary(rows);

        const visibleIds = new Set();

        for (const row of rows) {
            visibleIds.add(row.id);

            let elements = this._renderedRows.get(row.id);

            if (!elements) {
                elements = this.createRowElements(row);
                this._renderedRows.set(row.id, elements);
            }

            this.updateRowElements(elements, row);
        }

        for (const [id, elements] of this._renderedRows) {
            if (!visibleIds.has(id)) {
                elements.tr.remove();
            }
        }

        const orderedRows = rows.map(row =>
            this._renderedRows.get(row.id).tr
        );

        const currentRows = [...tbody.children].filter(
            element => !element.classList.contains("empty")
        );

        const orderChanged =
            currentRows.length !== orderedRows.length ||
            currentRows.some((element, index) =>
                element !== orderedRows[index]
            );

        if (orderChanged) {
            const fragment = document.createDocumentFragment();

            orderedRows.forEach(tr => fragment.appendChild(tr));

            tbody.replaceChildren(fragment);
        }

        if (rows.length === 0) {
            let emptyRow = tbody.querySelector("tr.empty");

            if (!emptyRow) {
                emptyRow = document.createElement("tr");
                emptyRow.className = "empty";

                const td = document.createElement("td");
                td.colSpan = 7;
                td.className = "empty";
                td.textContent = "Ei näytettäviä laitteita.";

                emptyRow.appendChild(td);
                tbody.appendChild(emptyRow);
            }
        } else {
            tbody.querySelector("tr.empty")?.remove();
        }

        this.shadowRoot.querySelectorAll("[data-filter]").forEach(input => {
            const result = input.value
                ? this.makeRegExp(input.value)
                : null;

            const isComparison =
                this.parseComparisonFilter(input.value);

            const numericColumn =
                [4, 5].includes(Number(input.dataset.filter));

            const invalid = Boolean(
                result &&
                !result.regex &&
                !(numericColumn && isComparison)
            );

            input.parentElement.classList.toggle("invalid", invalid);
            input.title = invalid ? result.error : "";
        });

        errorElement.textContent = [...new Set(filterErrors)].join(" ");

        if (!manufacturerResult.regex) {
            status.textContent =
                `Valmistajan RegExp on virheellinen: ` +
                manufacturerResult.error;
        } else if (this.registryError) {
            status.textContent = this.registryError;
        } else if (!this.registryLoaded) {
            status.textContent = "Haetaan laitteita...";
        } else {
            status.textContent =
                `Näytetään ${rows.length} / ${allRows.length} laitetta`;
        }
    }

    getCardSize() {
        return Math.max(2, this.deviceRows.length + 2);
    }
}

customElements.define("shelly-table-card", ShellyTableCard);
