/**
 * inspect_TP.js
 * 台北市即時申挖資訊模組
 * -----------------------------------------------------
 * 此模組獨立於 map.html，不需要改 map.html 結構，
 * 由 map.html 透過 <script> 或動態載入呼叫。
 *
 * 外部需呼叫： TPInspect.init( view, map ) 開啟模組
 */

const TPInspect = (() => {

    // ====== 模組內部變數 ========
    let _view = null;
    let _map = null;

    // 專用圖層
    let _graphicLayer = null;

    // 下載 JSON URL
    const TAIPEI_URL =
        "https://tpnco.blob.core.windows.net/blobfs/Appwork.json";


    // ======================================================
    // ★★★ 主初始化：map.html 會呼叫這裡 ★★★
    // ======================================================
    async function init(view, map) {
        console.log("【TPInspect】初始化…");

        _view = view;
        _map = map;

        // 建立圖層
        _graphicLayer = new GraphicsLayer({
            title: "TP 即時申挖資訊"
        });
        _map.add(_graphicLayer);

        // 下載 JSON + 處理
        await loadTPData();

        // 設定點擊 Identify
        setupIdentify();

        console.log("【TPInspect】初始化完成");
    }


    // ======================================================
    // ★ 下載台北 JSON
    // ======================================================
    async function loadTPData() {
        try {
            console.log("【TPInspect】下載施工資料…");

            const res = await fetch(TAIPEI_URL);
            if (!res.ok) throw new Error("HTTP " + res.status);

            const json = await res.json();

            if (!json.features || !Array.isArray(json.features)) {
                console.error("【TPInspect】JSON 格式錯誤");
                return;
            }

            console.log(`【TPInspect】共 ${json.features.length} 筆施工資料`);

            // 逐筆處理
            for (const f of json.features) {
                handleFeature(f);
            }

        } catch (e) {
            console.error("【TPInspect】資料下載失敗：", e);
        }
    }


    // ======================================================
    // ★ 處理每個 feature：解析 + geometry 轉換 + 加入地圖
    // ======================================================
    function handleFeature(feature) {

        const props = feature.properties || {};
        const geom = feature.geometry || {};

        // 轉換為 ArcGIS Geometry
        const arcGeom = convertPositionsToGeometry(geom);
        if (!arcGeom) return;

        // 建 graphic
        const graphic = new Graphic({
            geometry: arcGeom,
            attributes: {
                acno: props.Ac_no || "",
                addr: props.Addr || "",
                vendor: props.Tc_Na || "",
                start: props.Cb_Da || "",
                end: props.Ce_Da || "",
                raw: props
            },
            symbol: createDefaultSymbol()
        });

        _graphicLayer.add(graphic);
    }


    // ======================================================
    // ★ Geometry 轉換骨架
    // ======================================================
    function convertPositionsToGeometry(geometry) {

        if (!geometry.Positions_type || !geometry.Positions) return null;

        const type = geometry.Positions_type;
        const pos = geometry.Positions;

        const SR = { wkid: 3826 };

        if (type === "MultiLineString") {
            return {
                type: "polyline",
                paths: pos,
                spatialReference: SR
            };
        }

        if (type === "MultiPolygon") {
            return {
                type: "polygon",
                rings: pos.flat(),      // 攤平所有 polygon ring
                spatialReference: SR
            };
        }

        console.warn("未知 Positions_type:", type);
        return null;
    }


    // ======================================================
    // ★ 預設符號（之後會依照交集數量調整）
    // ======================================================
    function createDefaultSymbol() {
        return {
            type: "simple-fill",
            color: [255, 0, 0, 0.4], // 半透明紅色
            outline: {
                color: [255, 0, 0],
                width: 1
            }
        };
    }


    // ======================================================
    // ★ 設定 Identify（點擊施工區塊 → 顯示 popup）
    // ======================================================
    function setupIdentify() {

        _view.on("click", async (event) => {

            const res = await _view.hitTest(event);

            if (!res.results.length) return;

            const g = res.results[0].graphic;
            if (!_graphicLayer.graphics.includes(g)) return;

            showPopup(g);
        });
    }


    // ======================================================
    // ★ Popup（基礎骨架）
    // ======================================================
    function showPopup(graphic) {

        const attr = graphic.attributes.raw;

        _view.popup.open({
            title: `施工編號：${attr.Ac_no}`,
            content: `
                <b>地址：</b>${attr.Addr}<br>
                <b>施工單位：</b>${attr.App_Name}<br>
                <b>起訖：</b>${attr.Cb_Da} ~ ${attr.Ce_Da}<br><br>

                <button onclick="TPInspect.openNote('${attr.Ac_no}')">
                    新增巡勘備註
                </button>
                <button onclick="TPInspect.punch('${attr.Ac_no}')">
                    打卡
                </button>
                <button onclick="TPInspect.sendSMS('${attr.Ac_no}')">
                    發送簡訊
                </button>
                <button onclick="TPInspect.navigate('${attr.Addr}')">
                    導航
                </button>
            `,
            location: graphic.geometry
        });
    }


    // ======================================================
    // ★ 以下為預留接口（之後逐步實作）
    // ======================================================

    // Firebase 備註
    function openNote(acno) {
        console.log("openNote:", acno);
        // TODO：接 Firebase
    }

    // 打卡（GPS）
    function punch(acno) {
        console.log("punch:", acno);
        // TODO：呼叫 Android 取得位置並比對距離
    }

    // 發送簡訊
    function sendSMS(acno) {
        console.log("sendSMS:", acno);
        // TODO：Android 接口，發送簡訊給廠商/我方人員
    }

    // Google Map 導航
    function navigate(addr) {
        console.log("navigate to:", addr);
        // TODO：使用 google maps URL
    }


    // ======================================================
    // ★ 對外暴露
    // ======================================================
    return {
        init,
        openNote,
        punch,
        sendSMS,
        navigate
    };

})();   // END IIFE
