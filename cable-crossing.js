/**
 * 跨越纜線資料建立模組 (Cable Crossing Module)
 *
 * 功能：
 * 1. 查詢附近 80M 電桿
 * 2. 選擇電桿並查詢詳細資訊
 * 3. 填寫跨越纜線資料
 * 4. 送出資料到 API
 */

const CableCrossingModule = (() => {
  'use strict';

  // ===== 狀態管理 =====
  let isActive = false;               // 是否啟用中
  let currentPosition = null;         // 目前位置 [x, y]
  let selectedPole = null;            // 所選電桿
  let nearbyPoles = [];               // 附近電桿清單
  let venders = [];                   // 業者清單
  let poleInfo = null;                // 電桿詳細資訊

  // ===== ArcGIS 物件 =====
  let view = null;
  let GraphicClass = null;
  let PointClass = null;
  let SimpleMarkerSymbolClass = null;
  let geometryEngine = null;
  let FeatureLayerClass = null;
  let MapImageLayerClass = null;

  // ===== 回調函數 =====
  let onShowMessage = null;           // 顯示訊息
  let onShowPoleList = null;          // 顯示電桿清單
  let onShowCableForm = null;         // 顯示纜線表單
  let onPolesInfoReceived = null;     // 電桿資訊接收完成
  let onSubmitSuccess = null;         // 送出成功

  // ===== 配置 =====
  const SEARCH_DISTANCE = 80;         // 搜尋距離（公尺）
  const TEST_POINT_KEY = 'gpspoint';  // 測試座標 key

  /**
   * 初始化模組
   */
  function init(arcgisObjects, callbacks) {
    console.log('CableCrossingModule 初始化...');

    // 設定 ArcGIS 物件
    view = arcgisObjects.view;
    GraphicClass = arcgisObjects.Graphic;
    PointClass = arcgisObjects.Point;
    SimpleMarkerSymbolClass = arcgisObjects.SimpleMarkerSymbol;
    geometryEngine = arcgisObjects.geometryEngine;
    FeatureLayerClass = arcgisObjects.FeatureLayer;
    MapImageLayerClass = arcgisObjects.MapImageLayer;

    // 設定回調函數
    onShowMessage = callbacks.onShowMessage || null;
    onShowPoleList = callbacks.onShowPoleList || null;
    onShowCableForm = callbacks.onShowCableForm || null;
    onPolesInfoReceived = callbacks.onPolesInfoReceived || null;
    onSubmitSuccess = callbacks.onSubmitSuccess || null;

    console.log('✓ CableCrossingModule 初始化完成');
  }

  /**
   * 取得目前位置（真實 GPS 或測試座標）
   */
  function getCurrentPosition() {
    return new Promise((resolve, reject) => {
      // 優先使用測試座標
      if (window.Android && window.Android.getGpsPoint) {
        try {
          const testPoint = window.Android.getGpsPoint();
          if (testPoint && testPoint.trim()) {
            // 解析格式: "302900,2770117"
            const [x, y] = testPoint.split(',').map(Number);
            if (!isNaN(x) && !isNaN(y)) {
              console.log('✓ 使用測試座標:', x, y);
              if (onShowMessage) {
                onShowMessage('使用測試座標模式');
              }
              resolve([x, y]);
              return;
            }
          } else {
            console.log('測試座標為空，使用地圖中心點');
          }
        } catch (e) {
          console.error('解析測試座標失敗:', e);
        }
      } else {
        console.log('Android.getGpsPoint 不可用，使用地圖中心點');
      }

      // 使用地圖中心點作為 fallback
      if (view && view.center) {
        const center = view.center;
        const wkid = view.spatialReference.wkid;

        console.log('地圖中心點:', center.x, center.y);
        console.log('地圖座標系統 WKID:', wkid);

        // 檢查座標系統
        if (wkid === 3826) {
          // TWD97 - 直接使用
          console.log('✓ 地圖使用 TWD97 座標系統');
          resolve([center.x, center.y]);
        } else if (wkid === 3857 || wkid === 102100) {
          // Web Mercator - 需要提示使用者
          console.warn('地圖使用 Web Mercator，建議設定測試座標');
          if (onShowMessage) {
            onShowMessage('建議在 strings.xml 設定測試座標（gpspoint）');
          }
          // 仍然嘗試使用，但結果可能不正確
          resolve([center.x, center.y]);
        } else if (wkid === 4326) {
          // WGS84 經緯度 - 需要提示使用者
          console.warn('地圖使用 WGS84 經緯度，建議設定測試座標');
          if (onShowMessage) {
            onShowMessage('建議在 strings.xml 設定測試座標（gpspoint）');
          }
          // 仍然嘗試使用，但結果可能不正確
          resolve([center.x, center.y]);
        } else {
          // 其他座標系統
          console.warn('未知的座標系統:', wkid);
          if (onShowMessage) {
            onShowMessage('建議在 strings.xml 設定測試座標（gpspoint）');
          }
          resolve([center.x, center.y]);
        }
      } else {
        console.error('無法取得地圖中心點');
        reject(new Error('無法取得位置'));
      }
    });
  }

  /**
   * 查詢附近 80M 的電桿
   */
  async function searchNearbyPoles(point, layerList) {
    console.log('查詢附近電桿，中心點:', point);

    try {
      // 1. 建立 Buffer (80公尺)
      const pointGeometry = new PointClass({
        x: point[0],
        y: point[1],
        spatialReference: { wkid: 3826 }
      });

      const buffer = geometryEngine.buffer(pointGeometry, SEARCH_DISTANCE, "meters");
      console.log('✓ Buffer 已建立:', SEARCH_DISTANCE, '公尺');

      // 2. 從 layerList 找到電纜圖圖層
      const targetLayer = layerList.find(l => l.name === '電纜圖');
      if (!targetLayer || !targetLayer.url) {
        throw new Error('找不到電纜圖圖層');
      }

      console.log('✓ 找到電纜圖圖層');
      console.log('圖層 URL:', targetLayer.url);

      // 3. 建立臨時圖層查詢
      const tempLayer = new MapImageLayerClass({
        url: targetLayer.url
      });

      await tempLayer.load();
      console.log('✓ 圖層已載入');

      // 4. 找到纜電桿(G69)子圖層
      const sublayers = tempLayer.allSublayers.items;
      console.log('圖層包含', sublayers.length, '個子圖層');

      const poleLayer = sublayers.find(layer =>
        layer.title && layer.title.includes('纜電桿') && layer.title.includes('G69')
      );

      if (!poleLayer) {
        console.error('可用的子圖層:');
        sublayers.forEach(layer => {
          console.error('  -', layer.title);
        });
        throw new Error('找不到纜電桿(G69)圖層');
      }

      console.log('✓ 找到子圖層:', poleLayer.title);

      // 5. 執行空間查詢
      const query = poleLayer.createQuery();
      query.geometry = buffer;
      query.spatialRelationship = "intersects";
      query.returnGeometry = true;
      query.outFields = ["FULLNO_", "POLNAM", "POLNUM", "OBJECTID"];

      const results = await poleLayer.queryFeatures(query);

      console.log('✓ 查詢完成，找到', results.features.length, '個電桿');

      if (results.features.length === 0) {
        if (onShowMessage) {
          onShowMessage('附近 80 公尺內沒有找到電桿');
        }
        return [];
      }

      // 6. 處理結果
      const poles = results.features.map(feature => {
        const attrs = feature.attributes;
        const geometry = feature.geometry;

        // 計算距離
        const polePoint = new PointClass({
          x: geometry.x,
          y: geometry.y,
          spatialReference: { wkid: 3826 }
        });

        const distance = geometryEngine.distance(pointGeometry, polePoint, "meters");

        // 組合顯示名稱
        let displayName = attrs.FULLNO_ || '';
        if (attrs.POLNAM && attrs.POLNUM) {
          displayName += `-（${attrs.POLNAM}${attrs.POLNUM}）`;
        }

        return {
          fullNo: attrs.FULLNO_,
          polnam: attrs.POLNAM || '',
          polnum: attrs.POLNUM || '',
          objectId: attrs.OBJECTID,
          displayName: displayName,
          x: geometry.x,
          y: geometry.y,
          distance: distance
        };
      });

      // 7. 按距離排序
      poles.sort((a, b) => a.distance - b.distance);

      console.log('附近電桿清單:');
      poles.forEach((pole, index) => {
        console.log(`  ${index + 1}. ${pole.displayName} (${pole.distance.toFixed(1)}m)`);
      });

      return poles;

    } catch (error) {
      console.error('查詢電桿失敗:', error);
      if (onShowMessage) {
        onShowMessage('查詢電桿失敗: ' + error.message);
      }
      throw error;
    }
  }

  /**
   * 選擇電桿並 Zoom
   */
  async function selectPole(pole) {
    console.log('選擇電桿:', pole.displayName);

    selectedPole = pole;

    // Zoom 到電桿位置
    try {
      await view.goTo({
        target: {
          x: pole.x,
          y: pole.y,
          spatialReference: { wkid: 3826 }
        },
        zoom: 18
      }, {
        duration: 800
      });

      console.log('✓ 已 Zoom 到電桿位置');

      // 顯示確認對話框
      if (onShowMessage) {
        onShowMessage(`已選擇電桿：${pole.displayName}`);
      }

      return true;
    } catch (error) {
      console.error('Zoom 失敗:', error);
      return false;
    }
  }

  /**
   * 查詢電桿詳細資訊
   */
  async function getPoleInfo(fullNo, ldap) {
    console.log('=== 查詢電桿資訊 ===');
    console.log('電桿編號:', fullNo);
    console.log('LDAP:', ldap);

    // 檢查 Android 橋接
    console.log('window.Android 存在:', !!window.Android);
    console.log('window.Android.getPolesInfo 存在:', !!(window.Android && window.Android.getPolesInfo));

    if (!window.Android || !window.Android.getPolesInfo) {
      console.error('❌ Android.getPolesInfo not available');
      if (onShowMessage) {
        onShowMessage('無法呼叫 Android 功能');
      }
      return null;
    }

    try {
      // 組成請求資料
      const requestData = {
        poles: [fullNo],
        staff: ldap
      };

      console.log('✓ 請求資料:', requestData);
      console.log('✓ JSON 字串:', JSON.stringify(requestData));

      // 呼叫 Android
      console.log('✓ 呼叫 Android.getPolesInfo...');
      window.Android.getPolesInfo(JSON.stringify(requestData));
      console.log('✓ Android.getPolesInfo 已呼叫');

      // 實際回應會透過 onPolesInfoReceived 回調處理
      return true;

    } catch (error) {
      console.error('❌ 查詢電桿資訊失敗:', error);
      if (onShowMessage) {
        onShowMessage('查詢電桿資訊失敗');
      }
      return null;
    }
  }

  /**
   * 處理電桿資訊回應（由 Android 呼叫）
   */
  function handlePolesInfoResponse(jsonString) {
    console.log('收到電桿資訊回應');

    try {
      const data = JSON.parse(jsonString);

      console.log('電桿資訊:', data);

      // 儲存業者清單
      venders = data.venders || [];
      console.log('業者清單:', venders.length, '個');

      // 儲存電桿資訊
      // API 回傳的 poles 可能是物件或陣列
      if (data.poles) {
        if (Array.isArray(data.poles)) {
          // 陣列格式
          if (data.poles.length > 0) {
            poleInfo = data.poles[0];
          }
        } else {
          // 物件格式
          poleInfo = data.poles;
        }

        if (poleInfo) {
          console.log('✓ 電桿 FULLNO:', poleInfo.fullNo);
          console.log('✓ 相鄰電桿:', poleInfo.poleNeighbors ? poleInfo.poleNeighbors.length : 0, '個');
        }
      }

      // 呼叫回調
      if (onPolesInfoReceived) {
        onPolesInfoReceived(data);
      }

      return data;

    } catch (error) {
      console.error('❌ 解析電桿資訊失敗:', error);
      if (onShowMessage) {
        onShowMessage('解析電桿資訊失敗');
      }
      return null;
    }
  }

  /**
   * 組裝送出資料
   */
  function buildSubmitData(formData, ldap) {
    console.log('組裝送出資料...');

    // 處理 poleLines
    const poleLines = formData.poleLines.map(line => {
      const result = {
        vendertype: line.vendertype,
        vendersn: line.vendersn,
        vendername: line.vendername,
        linenum: parseInt(line.linenum) || 0,
        height: parseFloat(line.height) || 0,
        isrent: line.isrent || '0'
      };

      // 租用日期（已經是 ISO 8601 格式或空字串）
      result.leasedate = line.leasedate || '';

      return result;
    });

    // 組成完整資料
    const submitData = {
      staff: ldap,
      poles: [{
        fullNo: formData.mainPole,
        poleNeighbors: [{
          fullNo: formData.neighborFullNo,
          roadwidth: parseFloat(formData.roadwidth) || 0,
          note: formData.note || '',
          acrossroadtype: formData.acrossroadtype,
          picture: formData.photoBase64 || '',
          poleLines: poleLines
        }]
      }]
    };

    console.log('送出資料結構:');
    console.log('- 員工編號:', submitData.staff);
    console.log('- 主幹電桿:', submitData.poles[0].fullNo);
    console.log('- 他端電桿:', submitData.poles[0].poleNeighbors[0].fullNo);
    console.log('- 道路寬度:', submitData.poles[0].poleNeighbors[0].roadwidth);
    console.log('- 跨越類型:', submitData.poles[0].poleNeighbors[0].acrossroadtype);
    console.log('- 備註:', submitData.poles[0].poleNeighbors[0].note || '(無)');
    console.log('- 照片:', submitData.poles[0].poleNeighbors[0].picture ? `有 (${submitData.poles[0].poleNeighbors[0].picture.length} 字元)` : '無');
    console.log('- 附掛纜線:', poleLines.length, '條');

    poleLines.forEach((line, index) => {
      console.log(`  [${index + 1}] ${line.vendername} (${line.vendertype}-${line.vendersn})`);
      console.log(`      數量:${line.linenum} 高度:${line.height}m 租用:${line.isrent} 日期:${line.leasedate || '(無)'}`);
    });

    return submitData;
  }

  /**
   * 送出資料
   */
  function submitCableData(formData, ldap) {
    console.log('準備送出跨越纜線資料...');

    if (!window.Android || !window.Android.submitCableData) {
      console.error('Android.submitCableData not available');
      if (onShowMessage) {
        onShowMessage('無法呼叫 Android 功能');
      }
      return false;
    }

    try {
      // 組裝資料
      const submitData = buildSubmitData(formData, ldap);

      // 轉 JSON 字串
      const jsonString = JSON.stringify(submitData);

      console.log('JSON 長度:', jsonString.length, '字元');

      // 呼叫 Android
      window.Android.submitCableData(jsonString);

      return true;

    } catch (error) {
      console.error('送出資料失敗:', error);
      if (onShowMessage) {
        onShowMessage('送出資料失敗: ' + error.message);
      }
      return false;
    }
  }

  /**
   * 處理送出結果（由 Android 呼叫）
   */
  function handleSubmitResult(success, message) {
    console.log('送出結果:', success ? '成功' : '失敗');
    if (message) {
      console.log('訊息:', message);
    }

    if (onShowMessage) {
      onShowMessage(success ? '跨越纜線資料送出成功' : '送出失敗: ' + message);
    }

    if (success && onSubmitSuccess) {
      onSubmitSuccess();
    }
  }

  /**
   * 開始功能
   */
  async function start(layerList, ldap) {
    console.log('啟動跨越纜線資料建立...');

    if (isActive) {
      console.warn('功能已啟用中');
      return;
    }

    isActive = true;

    try {
      // 1. 取得目前位置
      if (onShowMessage) {
        onShowMessage('正在取得位置...');
      }

      currentPosition = await getCurrentPosition();
      console.log('✓ 目前位置:', currentPosition);

      // 2. 查詢附近電桿
      if (onShowMessage) {
        onShowMessage('查詢附近電桿...');
      }

      nearbyPoles = await searchNearbyPoles(currentPosition, layerList);

      if (nearbyPoles.length === 0) {
        isActive = false;
        return;
      }

      // 3. 顯示電桿清單
      if (onShowPoleList) {
        onShowPoleList(nearbyPoles);
      }

    } catch (error) {
      console.error('啟動失敗:', error);
      isActive = false;

      if (onShowMessage) {
        onShowMessage('啟動失敗: ' + error.message);
      }
    }
  }

  /**
   * 停止功能
   */
  function stop() {
    console.log('停止跨越纜線資料建立');

    isActive = false;
    currentPosition = null;
    nearbyPoles = [];
    selectedPole = null;
    poleInfo = null;
    venders = [];

    if (onShowMessage) {
      onShowMessage('');
    }
  }

  /**
   * 取得狀態
   */
  function getState() {
    return {
      isActive: isActive,
      currentPosition: currentPosition,
      selectedPole: selectedPole,
      nearbyPolesCount: nearbyPoles.length,
      vendersCount: venders.length,
      hasPoleInfo: !!poleInfo
    };
  }

  // ===== 公開 API =====

  return {
    init,
    start,
    stop,
    getState,
    getCurrentPosition,
    searchNearbyPoles,
    selectPole,
    getPoleInfo,
    submitCableData,
    buildSubmitData,

    // 給 Android 呼叫的回調
    handlePolesInfoResponse,
    handleSubmitResult,

    // Getter
    getNearbyPoles: () => nearbyPoles,
    getVenders: () => venders,
    getCurrentPoleInfo: () => poleInfo,  // 改名避免衝突
    getSelectedPole: () => selectedPole
  };
})();

// 掛載到全域
if (typeof window !== 'undefined') {
  window.CableCrossingModule = CableCrossingModule;
  console.log('✓ CableCrossingModule 已載入');
}
