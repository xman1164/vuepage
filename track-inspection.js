/**
 * 軌跡巡勘模組 (Track Inspection Module)
 *
 * 功能：
 * 1. GPS 軌跡記錄（或測試座標）
 * 2. 即時繪製紅線
 * 3. 距離過濾（2-50公尺）
 * 4. 空間查詢（Buffer 20m）
 * 5. 設備清單收集
 * 6. 軌跡暫存與重送
 */

const TrackInspectionModule = (() => {
  'use strict';

  // ===== 狀態管理 =====
  let isTracking = false;
  let trackPoints = [];          // TWD97 座標 [[x, y], ...]
  let warmupCount = 0;            // 預熱計數
  let lastRecordedPoint = null;   // 最後記錄的點（用於距離計算）
  let isTestMode = false;         // 測試座標模式（跳過距離檢查）
  let isResendMode = false;       // 重送模式（跳過預熱）

  // ===== 結果資料 =====
  let trackScreenshot = null;     // 軌跡截圖 (base64)
  let poleDevices = [];           // 電桿設備清單
  let otherDevices = [];          // 非電桿設備清單
  let deviceCounts = {};          // 各類設備數量

  // ===== ArcGIS 物件 =====
  let view = null;
  let GraphicClass = null;
  let PolylineClass = null;
  let SimpleLineSymbolClass = null;
  let geometryEngine = null;
  let projection = null;
  let reactiveUtils = null;

  // ===== 回調函數 =====
  let onUpdateStatus = null;      // 更新狀態（點數、距離等）
  let onShowConfirmDialog = null; // 顯示確認對話框
  let onShowMessage = null;       // 顯示訊息
  let onTrackingStarted = null;   // 軌跡開始
  let onTrackingStopped = null;   // 軌跡停止

  // ===== 配置 =====
  const MIN_DISTANCE = 2;         // 最小記錄距離（公尺）
  const MAX_DISTANCE = 50;        // 最大記錄距離（公尺）
  const WARMUP_POINTS = 2;        // 預熱點數
  const BUFFER_DISTANCE = 20;     // Buffer 距離（公尺）

  // ===== 圖層配置 =====
  const LAYER_CONFIGS = [
    {
      group: '電纜圖',
      name: '纜電桿(G69)',
      field: 'FULLNO_',
      type: 'pole',
      displayName: '電桿'
    },
    {
      group: '管道圖',
      name: '管道人孔(G60)',
      field: 'FULLNO_',
      type: 'manhole',
      displayName: '人孔'
    },
    {
      group: '管道圖',
      name: '管道手孔(G61)',
      field: 'FULLNO_',
      type: 'handhole',
      displayName: '手孔'
    },
    {
      group: '光纜圖',
      name: '戶外終端',
      field: 'ACCNOFULL_',
      type: 'cabinet',
      displayName: '交接箱'
    }
  ];

  // ===== 圖形物件 =====
  let trackGraphic = null;        // 紅線 Graphic
  let gpsWatchId = null;          // GPS 監聽 ID

  // ===== 工具函數 =====

  /**
   * 計算兩點平面距離（公尺）
   */
  function calculateDistance(point1, point2) {
    if (!geometryEngine || !point1 || !point2) return 0;

    const pt1 = {
      type: "point",
      x: point1[0],
      y: point1[1],
      spatialReference: { wkid: 3826 }
    };

    const pt2 = {
      type: "point",
      x: point2[0],
      y: point2[1],
      spatialReference: { wkid: 3826 }
    };

    return geometryEngine.distance(pt1, pt2, "meters");
  }

  /**
   * 檢查是否應該記錄此點
   */
  function shouldRecordPoint(newPoint) {
    // 重送模式：直接記錄（資料已經是處理過的，不需要再預熱）
    if (isResendMode) {
      return true;
    }

    // 前 WARMUP_POINTS 個點不記錄（預熱）
    if (warmupCount < WARMUP_POINTS) {
      warmupCount++;
      console.log(`預熱中... ${warmupCount}/${WARMUP_POINTS}`);
      return false;
    }

    // 測試模式：跳過距離檢查
    if (isTestMode) {
      return true;
    }

    // 第一個正式記錄點
    if (!lastRecordedPoint) {
      return true;
    }

    // 計算與上一個記錄點的距離
    const distance = calculateDistance(newPoint, lastRecordedPoint);

    console.log(`距離檢查: ${distance.toFixed(2)}m`);

    // 太近，忽略
    if (distance < MIN_DISTANCE) {
      console.log(`距離太近 (< ${MIN_DISTANCE}m)，忽略`);
      return false;
    }

    // 太遠，可能飄移，忽略
    if (distance > MAX_DISTANCE) {
      console.log(`距離太遠 (> ${MAX_DISTANCE}m)，可能飄移，忽略`);
      return false;
    }

    return true;
  }

  /**
   * 添加軌跡點
   */
  function addTrackPoint(point) {
    console.log('Adding track point:', point);

    if (shouldRecordPoint(point)) {
      trackPoints.push(point);
      lastRecordedPoint = point;

      // 更新紅線
      updateTrackLine();

      // 更新狀態
      if (onUpdateStatus) {
        onUpdateStatus({
          pointCount: trackPoints.length,
          warmup: warmupCount < WARMUP_POINTS
        });
      }

      console.log(`✓ 記錄點位 #${trackPoints.length}:`, point);
    }
  }

  /**
   * 更新紅線顯示
   */
  function updateTrackLine() {
    if (!view || !PolylineClass || !SimpleLineSymbolClass || !GraphicClass) {
      console.error('ArcGIS classes not ready');
      return;
    }

    if (trackPoints.length < 2) {
      // 至少需要2個點才能畫線
      return;
    }

    // 移除舊的紅線
    if (trackGraphic) {
      view.graphics.remove(trackGraphic);
    }

    // 建立新的 Polyline
    const polyline = new PolylineClass({
      paths: [trackPoints],
      spatialReference: { wkid: 3826 }
    });

    // 紅線符號
    const lineSymbol = new SimpleLineSymbolClass({
      color: [255, 0, 0],
      width: 4,
      style: "solid"
    });

    // 建立 Graphic
    trackGraphic = new GraphicClass({
      geometry: polyline,
      symbol: lineSymbol
    });

    view.graphics.add(trackGraphic);

    console.log('✓ 紅線已更新，共', trackPoints.length, '個點');
  }

  /**
   * GPS 位置更新處理
   */
  async function handleLocationUpdate(position) {
    if (!isTracking) return;

    console.log('===== GPS 位置更新 =====');
    console.log('GPS position:', position);
    console.log('經度:', position.coords.longitude);
    console.log('緯度:', position.coords.latitude);
    console.log('精度:', position.coords.accuracy, '公尺');

    // WGS84 座標
    const lon = position.coords.longitude;
    const lat = position.coords.latitude;

    // 轉換為 TWD97 (3826)
    if (!projection) {
      console.error('Projection module not loaded');
      if (onShowMessage) {
        onShowMessage('座標轉換模組未載入');
      }
      return;
    }

    try {
      // 確保 projection 已載入
      if (projection.isLoaded && !projection.isLoaded()) {
        console.log('載入 projection 模組...');
        await projection.load();
      }

      const wgs84Point = {
        type: "point",
        x: lon,
        y: lat,
        spatialReference: { wkid: 4326 }
      };

      console.log('WGS84 點:', wgs84Point);

      // 使用正確的 projection API
      const twd97Point = projection.project(wgs84Point, {
        wkid: 3826
      });

      if (!twd97Point) {
        console.error('座標轉換失敗：返回 null');
        return;
      }

      console.log('TWD97 點:', twd97Point);
      console.log('TWD97 座標: x=' + twd97Point.x + ', y=' + twd97Point.y);

      // 添加到軌跡
      addTrackPoint([twd97Point.x, twd97Point.y]);

      // GPS 跟隨（模擬 AutoPanMode.RECENTER）
      if (view) {
        view.goTo({
          target: twd97Point,
          zoom: view.zoom || 16
        }, {
          animate: true,
          duration: 200
        }).catch(err => {
          console.warn('地圖移動失敗:', err);
        });
      }
    } catch (error) {
      console.error('座標轉換失敗:', error);
      console.error('錯誤詳情:', error.message, error.stack);
      if (onShowMessage) {
        onShowMessage('GPS 座標轉換失敗');
      }
    }
  }

  /**
   * 啟動真實 GPS
   */
  function startRealGPS() {
    console.log('啟動真實 GPS...');

    if (!navigator.geolocation) {
      console.error('此瀏覽器不支援地理定位');
      if (onShowMessage) {
        onShowMessage('此裝置不支援 GPS 定位');
      }
      return false;
    }

    console.log('檢查 GPS 權限...');

    // 先嘗試取得一次位置（測試權限）
    navigator.geolocation.getCurrentPosition(
      (position) => {
        console.log('✓ GPS 權限正常');
        console.log('初始位置:', position.coords.latitude, position.coords.longitude);
        if (onShowMessage) {
          onShowMessage('GPS 已定位，開始記錄');
        }
      },
      (error) => {
        console.error('GPS 權限或定位錯誤:', error);
        let errorMsg = 'GPS 定位失敗: ';
        switch(error.code) {
          case error.PERMISSION_DENIED:
            errorMsg += '權限被拒絕，請開啟定位權限';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMsg += '無法取得位置，請確認 GPS 已開啟';
            break;
          case error.TIMEOUT:
            errorMsg += '定位逾時，請稍後再試';
            break;
          default:
            errorMsg += error.message;
        }
        if (onShowMessage) {
          onShowMessage(errorMsg);
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );

    // 開始監聽位置
    gpsWatchId = navigator.geolocation.watchPosition(
      handleLocationUpdate,
      (error) => {
        console.error('GPS watchPosition error:', error);
        console.error('錯誤代碼:', error.code);
        console.error('錯誤訊息:', error.message);

        let errorMsg = 'GPS 錯誤: ';
        switch(error.code) {
          case error.PERMISSION_DENIED:
            errorMsg += '權限被拒絕';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMsg += '位置無法取得';
            break;
          case error.TIMEOUT:
            errorMsg += '定位逾時';
            break;
          default:
            errorMsg += error.message;
        }

        if (onShowMessage) {
          onShowMessage(errorMsg);
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000  // 增加到 10 秒
      }
    );

    console.log('✓ GPS 監聽已啟動, watchId:', gpsWatchId);
    return true;
  }

  /**
   * 停止 GPS
   */
  function stopGPS() {
    if (gpsWatchId !== null) {
      navigator.geolocation.clearWatch(gpsWatchId);
      gpsWatchId = null;
      console.log('✓ GPS 監聽已停止');
    }
  }

  /**
   * 使用測試座標
   */
  function useTestCoordinates(gpsListString) {
    console.log('使用測試座標:', gpsListString);

    // 啟用測試模式（跳過距離檢查）
    isTestMode = true;

    // 解析格式: "297627,2772063 297628,2771939 297630,2771754"
    const coordPairs = gpsListString.trim().split(/\s+/);

    coordPairs.forEach((pair, index) => {
      const [x, y] = pair.split(',').map(Number);

      if (!isNaN(x) && !isNaN(y)) {
        // 模擬逐點添加（避免一次全加）
        setTimeout(() => {
          if (isTracking) {
            addTrackPoint([x, y]);

            // 跟隨到該點
            if (view) {
              view.goTo({
                target: { x, y, spatialReference: { wkid: 3826 } },
                zoom: view.zoom
              }, {
                animate: true,
                duration: 300
              });
            }

            // 如果是最後一個點，自動停止
            if (index === coordPairs.length - 1) {
              console.log('測試座標已全部添加，將自動停止');

              // 等待最後一個點的動畫完成後自動停止
              setTimeout(() => {
                if (isTracking && onShowMessage) {
                  onShowMessage('測試座標已完成，正在分析軌跡...');
                }

                // 觸發自動停止（需要從外部調用 stopTracking）
                if (window.autoStopTrackInspection) {
                  window.autoStopTrackInspection();
                }
              }, 1000);
            }
          }
        }, index * 1000); // 每秒一個點
      }
    });

    console.log(`✓ 已載入 ${coordPairs.length} 個測試座標，將在 ${coordPairs.length + 1} 秒後自動完成`);
  }

  /**
   * 建立 Polyline 並進行 Buffer
   */
  function createBufferedPolyline() {
    if (!PolylineClass || !geometryEngine) {
      console.error('Required ArcGIS modules not loaded');
      console.log('PolylineClass:', PolylineClass);
      console.log('geometryEngine:', geometryEngine);
      return null;
    }

    if (trackPoints.length < 2) {
      console.error('至少需要 2 個點才能建立 Polyline');
      return null;
    }

    console.log('建立 Polyline，點數:', trackPoints.length);
    console.log('點位:', trackPoints);

    // 建立 Polyline
    const polyline = new PolylineClass({
      paths: [trackPoints],
      spatialReference: { wkid: 3826 }
    });

    console.log('Polyline extent:', polyline.extent);

    // Buffer 20m
    const buffered = geometryEngine.buffer(polyline, BUFFER_DISTANCE, "meters");

    console.log('✓ Polyline Buffer 完成，範圍:', BUFFER_DISTANCE, '公尺');
    console.log('Buffered extent:', buffered.extent);
    console.log('Buffered type:', buffered.type);

    return buffered;
  }

  /**
   * 執行空間查詢
   */
  async function performSpatialQuery(bufferedGeometry, layerList, findLayerUrl, FeatureLayerClass, MapImageLayerClass, appToken) {
    console.log('開始空間查詢...');
    console.log('Buffer geometry:', bufferedGeometry);
    console.log('layerList:', layerList);
    console.log('appToken:', appToken ? '已設定' : '未設定');

    poleDevices = [];
    otherDevices = [];
    deviceCounts = {
      '電桿': 0,
      '人孔': 0,
      '手孔': 0,
      '交接箱': 0
    };

    const allDevices = new Set(); // 用於去重

    // 並行查詢所有圖層
    const queryPromises = LAYER_CONFIGS.map(async (config) => {
      try {
        console.log(`\n===== 查詢 ${config.displayName} =====`);

        // 找到圖層群組
        const targetLayer = layerList.find(l => l.name === config.group);
        if (!targetLayer || !targetLayer.url) {
          console.warn(`找不到圖層群組: ${config.group}`);
          console.log('可用圖層:', layerList.map(l => l.name));
          return { config, features: [] };
        }

        console.log(`圖層群組 URL: ${targetLayer.url}`);

        // 載入圖層（使用傳入的 MapImageLayerClass）
        const tempLayer = new MapImageLayerClass({
          url: targetLayer.url,
          customParameters: { token: appToken }
        });

        await tempLayer.load();
        console.log(`圖層已載入: ${config.group}`);

        // 找到子圖層 URL
        const targetLayerUrl = findLayerUrl(tempLayer, config.name);
        if (!targetLayerUrl) {
          console.warn(`找不到子圖層: ${config.name}`);
          console.log('可用子圖層:', tempLayer.allSublayers.map(s => s.title));
          return { config, features: [] };
        }

        console.log(`子圖層 URL: ${targetLayerUrl}`);

        // 建立 FeatureLayer
        const queryLayer = new FeatureLayerClass({
          url: targetLayerUrl,
          customParameters: { token: appToken }
        });

        // 建立空間查詢
        const query = queryLayer.createQuery();
        query.geometry = bufferedGeometry;
        query.spatialRelationship = "intersects";
        query.outFields = [config.field];
        query.returnGeometry = false;

        console.log(`執行查詢，欄位: ${config.field}`);

        // 執行查詢
        const results = await queryLayer.queryFeatures(query);

        console.log(`${config.displayName}: 找到 ${results.features.length} 筆`);

        if (results.features.length > 0) {
          console.log('前3筆資料:', results.features.slice(0, 3).map(f => f.attributes));
        }

        return { config, features: results.features };

      } catch (error) {
        console.error(`查詢 ${config.displayName} 失敗:`, error);
        console.error('錯誤詳情:', error.message, error.stack);
        return { config, features: [] };
      }
    });

    // 等待所有查詢完成
    const results = await Promise.all(queryPromises);

    // 處理結果
    results.forEach(({ config, features }) => {
      const deviceList = [];

      features.forEach(feature => {
        const deviceName = feature.attributes[config.field];

        // 過濾 null、空白
        if (deviceName && deviceName.trim() && !allDevices.has(deviceName)) {
          deviceList.push(deviceName.trim());
          allDevices.add(deviceName);
        }
      });

      // 更新數量
      deviceCounts[config.displayName] = deviceList.length;

      // 分類存放
      if (config.type === 'pole') {
        poleDevices.push(...deviceList);
      } else {
        otherDevices.push(...deviceList);
      }
    });

    // 排序
    poleDevices.sort();
    otherDevices.sort();

    console.log('空間查詢完成:');
    console.log('  電桿:', poleDevices.length, '個');
    console.log('  其他:', otherDevices.length, '個');
    console.log('  總計:', allDevices.size, '個');

    return allDevices.size > 0;
  }

  /**
   * 等待地圖完全載入（使用繪製完成事件）
   */
  async function waitForMapReady(view, reactiveUtils) {
    console.log('等待地圖載入完成...');

    // 1. 等待 view.updating 變為 false（類似 DrawStatus.COMPLETED）
    await reactiveUtils.whenOnce(() => !view.updating);
    console.log('✓ View 更新完成');

    // 2. 等待所有圖層繪製完成
    if (view.allLayerViews && view.allLayerViews.length > 0) {
      console.log('等待圖層繪製完成...');

      // 等待所有圖層的 updating 變為 false
      const layerPromises = view.allLayerViews.items.map(async (layerView) => {
        try {
          await reactiveUtils.whenOnce(() => !layerView.updating);
          console.log(`✓ 圖層已繪製: ${layerView.layer.title || layerView.layer.id}`);
        } catch (err) {
          console.warn('圖層繪製警告:', err);
        }
      });

      await Promise.all(layerPromises);
      console.log('✓ 所有圖層繪製完成');
    }

    // 3. 再次確認 view 不在更新狀態（可能有延遲的更新）
    if (view.updating) {
      console.log('偵測到延遲更新，繼續等待...');
      await reactiveUtils.whenOnce(() => !view.updating);
    }

    // 4. 檢查是否還有動畫在進行
    if (view.animating) {
      console.log('偵測到動畫進行中，等待動畫結束...');
      await reactiveUtils.whenOnce(() => !view.animating);
      console.log('✓ 動畫已結束');
    }

    // 5. 等待多個渲染幀確保畫面完全穩定
    console.log('等待渲染穩定...');
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
    }

    // 6. 最後再次確認沒有更新
    if (view.updating || view.animating) {
      console.log('最後檢查：仍在更新或動畫中，再等待...');
      await reactiveUtils.whenOnce(() => !view.updating && !view.animating);
    }

    // 7. 額外等待 3 秒確保底圖完全載入
    console.log('額外等待 3 秒確保底圖完全載入...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log('✓ 額外等待完成');

    console.log('✓ 地圖載入完成，可以截圖');
  }

  /**
   * 儲存軌跡資料（透過 Android）
   */
  function saveTrackData() {
    const trackData = {
      trackPoints: trackPoints,  // 改為 trackPoints（與讀取時一致）
      timestamp: Date.now(),
      poleDevices: poleDevices,
      otherDevices: otherDevices,
      deviceCounts: deviceCounts,
      screenshot: trackScreenshot
    };

    const jsonString = JSON.stringify(trackData);

    if (window.Android && window.Android.saveTrackData) {
      window.Android.saveTrackData(jsonString);
      console.log('✓ 軌跡資料已儲存');
    } else {
      // Fallback: localStorage
      try {
        localStorage.setItem('track_data', jsonString);
        console.log('✓ 軌跡資料已儲存至 localStorage');
      } catch (e) {
        console.error('儲存軌跡失敗:', e);
      }
    }
  }

  // ===== 公開 API =====

  return {
    /**
     * 初始化模組
     */
    init(arcgisObjects, callbacks) {
      console.log('TrackInspectionModule 初始化...');

      // 設定 ArcGIS 物件
      view = arcgisObjects.view;
      GraphicClass = arcgisObjects.Graphic;
      PolylineClass = arcgisObjects.Polyline;
      SimpleLineSymbolClass = arcgisObjects.SimpleLineSymbol;
      geometryEngine = arcgisObjects.geometryEngine;
      projection = arcgisObjects.projection;
      reactiveUtils = arcgisObjects.reactiveUtils;

      // 設定回調
      if (callbacks) {
        onUpdateStatus = callbacks.onUpdateStatus || null;
        onShowConfirmDialog = callbacks.onShowConfirmDialog || null;
        onShowMessage = callbacks.onShowMessage || null;
        onTrackingStarted = callbacks.onTrackingStarted || null;
        onTrackingStopped = callbacks.onTrackingStopped || null;
      }

      console.log('✓ TrackInspectionModule 初始化完成');
    },

    /**
     * 開始軌跡記錄
     */
    startTracking() {
      console.log('開始軌跡記錄...');

      // 強制停止之前的記錄（如果有）
      if (isTracking) {
        console.warn('偵測到之前的軌跡記錄，強制停止');
        stopGPS();
        if (trackGraphic && view) {
          view.graphics.remove(trackGraphic);
          trackGraphic = null;
        }
      }

      // 重置狀態
      isTracking = true;
      trackPoints = [];
      warmupCount = 0;
      lastRecordedPoint = null;
      isTestMode = false;
      isResendMode = false;  // 確保不是重送模式
      poleDevices = [];
      otherDevices = [];
      deviceCounts = {};
      trackScreenshot = null;

      // 清除舊的紅線
      if (trackGraphic) {
        view.graphics.remove(trackGraphic);
        trackGraphic = null;
      }

      // 檢查測試座標
      let testGpsList = '';
      if (window.Android && window.Android.getGpsTestList) {
        testGpsList = window.Android.getGpsTestList();
      }

      if (testGpsList && testGpsList.trim()) {
        // 使用測試座標
        console.log('使用測試座標模式');
        if (onShowMessage) {
          onShowMessage('使用測試座標模式');
        }
        useTestCoordinates(testGpsList);
      } else {
        // 啟動真實 GPS
        console.log('使用真實 GPS 模式');

        // 檢查 projection 是否可用
        if (!projection) {
          console.error('Projection 模組未載入，無法使用真實 GPS');
          if (onShowMessage) {
            onShowMessage('座標轉換模組未就緒，請稍後再試或使用測試座標模式');
          }
          isTracking = false;
          if (onTrackingStopped) {
            onTrackingStopped();
          }
          return;
        }

        if (!startRealGPS()) {
          isTracking = false;
          if (onTrackingStopped) {
            onTrackingStopped();
          }
          return;
        }
        if (onShowMessage) {
          onShowMessage('GPS 定位已啟動');
        }
      }

      // 通知開始
      if (onTrackingStarted) {
        onTrackingStarted();
      }

      console.log('✓ 軌跡記錄已開始');
    },

    /**
     * 停止軌跡記錄
     */
    async stopTracking(layerList, findLayerUrl, FeatureLayerClass, MapImageLayerClass, appToken) {
      if (!isTracking) {
        console.warn('沒有正在記錄的軌跡');
        return;
      }

      console.log('停止軌跡記錄...');

      isTracking = false;
      stopGPS();

      // 通知停止
      if (onTrackingStopped) {
        onTrackingStopped();
      }

      // 檢查是否有足夠的點
      if (trackPoints.length < 2) {
        if (onShowMessage) {
          onShowMessage('軌跡點位不足，需至少 2 個點');
        }
        console.warn('軌跡點位不足');
        return;
      }

      console.log(`✓ 軌跡記錄完成，共 ${trackPoints.length} 個點`);

      // 顯示處理中訊息
      if (onShowMessage) {
        onShowMessage('正在分析軌跡...');
      }

      try {
        // 1. Zoom to Extent（並等待動畫完成）
        const polyline = new PolylineClass({
          paths: [trackPoints],
          spatialReference: { wkid: 3826 }
        });

        const extent = polyline.extent;
        if (extent) {
          console.log('開始縮放至軌跡範圍...');
          console.log('Extent:', extent);

          // 執行 Zoom 並等待完成
          await view.goTo(extent.expand(1.5), {
            animate: true,
            duration: 1000  // 明確指定動畫時間
          });

          console.log('✓ Zoom 動畫已觸發');

          // 等待 Zoom 動畫真正完成
          // view.goTo() 可能在動畫開始時就返回，所以要再確認
          await reactiveUtils.whenOnce(() => !view.updating);

          console.log('✓ 已完全縮放至軌跡範圍');
        }

        // 2. 等待地圖完全載入（監聽繪製完成）
        console.log('等待地圖渲染完成...');
        await waitForMapReady(view, reactiveUtils);

        // 3. 截圖（包含所有圖層）
        console.log('開始截圖...');
        const screenshot = await view.takeScreenshot({
          format: 'png',
          quality: 95,
          width: view.width,
          height: view.height
        });
        trackScreenshot = screenshot.dataUrl;
        console.log('✓ 軌跡截圖完成');
        console.log('截圖尺寸:', screenshot.width, 'x', screenshot.height);

        // 4. 建立 Buffer 並進行空間查詢
        const bufferedGeometry = createBufferedPolyline();
        if (!bufferedGeometry) {
          throw new Error('建立 Buffer 失敗');
        }

        const hasDevices = await performSpatialQuery(
          bufferedGeometry,
          layerList,
          findLayerUrl,
          FeatureLayerClass,
          MapImageLayerClass,
          appToken
        );

        // 5. 儲存資料
        saveTrackData();

        // 6. 顯示結果
        if (!hasDevices) {
          // 沒有偵測到任何設備
          if (onShowMessage) {
            onShowMessage('未偵測到任何設備');
          }
          console.log('未偵測到任何設備，不顯示確認對話框');
          return;
        }

        // 有設備，顯示確認對話框
        if (onShowConfirmDialog) {
          onShowConfirmDialog({
            deviceCounts: deviceCounts,
            poleDevices: poleDevices,
            otherDevices: otherDevices,
            screenshot: trackScreenshot,
            trackPoints: trackPoints
          });
        }

      } catch (error) {
        console.error('停止軌跡處理失敗:', error);
        if (onShowMessage) {
          onShowMessage('軌跡分析失敗: ' + error.message);
        }
      }
    },

    /**
     * 確認並發送
     */
    confirmAndSend() {
      console.log('確認發送軌跡...');

      if (!trackScreenshot || poleDevices.length + otherDevices.length === 0) {
        console.error('沒有可發送的資料');
        if (onShowMessage) {
          onShowMessage('沒有可發送的資料');
        }
        return;
      }

      // 準備資料
      const trackData = {
        poleDevices: poleDevices,           // G69 電桿設備
        otherDevices: otherDevices,         // 非 G69 設備
        screenshot: trackScreenshot,        // 截圖 base64
        deviceCounts: deviceCounts,         // 設備數量統計
        trackPoints: trackPoints            // 軌跡點位（備用）
      };

      console.log('準備發送資料:');
      console.log('- 電桿設備:', poleDevices.length, '個');
      console.log('- 其他設備:', otherDevices.length, '個');
      console.log('- 截圖大小:', trackScreenshot.length, 'bytes');

      // 呼叫 Android 發送 API
      if (window.Android && window.Android.sendTrackInspection) {
        const jsonData = JSON.stringify(trackData);
        window.Android.sendTrackInspection(jsonData);
        console.log('✓ 已呼叫 Android 發送功能');
      } else {
        console.error('Android.sendTrackInspection 未定義');
        if (onShowMessage) {
          onShowMessage('發送功能未就緒，請更新 App 版本');
        }
      }

      // 清理（發送成功後由 Android 回調清除）
      // this.clearTrack();
    },

    /**
     * 取消軌跡
     */
    cancelTrack() {
      console.log('取消軌跡');

      if (onShowMessage) {
        onShowMessage('已取消');
      }

      this.clearTrack();

    },

    /**
     * 清除軌跡
     */
    clearTrack() {
      console.log('清除軌跡...');

      // 移除紅線
      if (trackGraphic && view) {
        view.graphics.remove(trackGraphic);
        trackGraphic = null;
      }

      // 重置狀態
      trackPoints = [];
      warmupCount = 0;
      lastRecordedPoint = null;
      isTestMode = false;
      isResendMode = false;  // 重置重送模式
      poleDevices = [];
      otherDevices = [];
      deviceCounts = {};
      trackScreenshot = null;

      console.log('✓ 軌跡已清除');
    },
    confirmAndSend() {
      console.log('準備送出軌跡資料...');

      // 檢查必要資料
      if (!trackScreenshot) {
        console.error('沒有截圖資料');
        if (onShowMessage) {
          onShowMessage('錯誤：截圖資料遺失');
        }
        return;
      }

      if (trackPoints.length === 0) {
        console.error('沒有軌跡點');
        if (onShowMessage) {
          onShowMessage('錯誤：軌跡點資料遺失');
        }
        return;
      }

      // 檢查 Android 發送功能
      if (!window.Android || !window.Android.sendTrackInspection) {
        console.error('發送功能未就緒');
        if (onShowMessage) {
          onShowMessage('錯誤：發送功能未就緒');
        }
        return;
      }

      // 準備發送資料
      const trackData = {
        poleDevices: poleDevices,        // G69 電桿設備
        otherDevices: otherDevices,      // 非電桿設備（人孔/手孔/交接箱等）
        screenshot: trackScreenshot,      // 截圖 (base64)
        deviceCounts: deviceCounts,       // 各類設備數量
        trackPoints: trackPoints          // 軌跡點（供重送使用）
      };

      console.log('發送軌跡資料:');
      console.log('- 電桿設備:', poleDevices.length, '個');
      console.log('- 其他設備:', otherDevices.length, '個');
      console.log('- 軌跡點:', trackPoints.length, '個');
      console.log('- 截圖大小:', trackScreenshot.length, 'chars');

      try {
        // 將資料轉為 JSON 字串並發送
        const jsonData = JSON.stringify(trackData);
        console.log('JSON 長度:', jsonData.length);

        window.Android.sendTrackInspection(jsonData);
        console.log('✓ 已呼叫 Android.sendTrackInspection');

        if (onShowMessage) {
          onShowMessage('正在上傳軌跡資料...');
        }

      } catch (e) {
        console.error('發送失敗:', e);
        if (onShowMessage) {
          onShowMessage('發送失敗: ' + e.message);
        }
      }
    },

    /**
     * 載入已儲存的軌跡（重送功能）
     */
    loadSavedTrack() {
      console.log('載入已儲存的軌跡...');

      let trackDataJson = '';

      // 嘗試從 Android 讀取
      if (window.Android && window.Android.getTrackData) {
        trackDataJson = window.Android.getTrackData();
      }

      // Fallback: localStorage
      if (!trackDataJson) {
        try {
          trackDataJson = localStorage.getItem('track_data') || '';
        } catch (e) {
          console.error('讀取軌跡失敗:', e);
        }
      }

      if (!trackDataJson) {
        if (onShowMessage) {
          onShowMessage('沒有已儲存的軌跡');
        }
        return null;
      }

      try {
        const trackData = JSON.parse(trackDataJson);

        console.log('✓ 軌跡資料已載入:', trackData);

        // 恢復狀態
        trackPoints = trackData.points || [];
        poleDevices = trackData.poleDevices || [];
        otherDevices = trackData.otherDevices || [];
        deviceCounts = trackData.deviceCounts || {};
        trackScreenshot = trackData.screenshot || null;

        // 重新繪製紅線
        if (trackPoints.length >= 2) {
          updateTrackLine();
        }

        return trackData;

      } catch (e) {
        console.error('解析軌跡資料失敗:', e);
        if (onShowMessage) {
          onShowMessage('軌跡資料格式錯誤');
        }
        return null;
      }
    },

    /**
     * 重送上次軌跡
     */
    async resendLastTrack() {
      console.log('準備重送上次軌跡...');

      // 檢查是否正在追蹤
      if (isTracking) {
        console.warn('目前正在追蹤中，無法重送');
        if (onShowMessage) {
          onShowMessage('請先停止目前的軌跡記錄');
        }
        return;
      }

      // 從 Android 取得上次軌跡資料
      let lastTrackData = null;

      if (window.Android && window.Android.getTrackData) {
        try {
          const jsonString = window.Android.getTrackData();
          if (jsonString) {
            lastTrackData = JSON.parse(jsonString);
            console.log('從 Android 取得軌跡資料:', lastTrackData);
          } else {
            console.log('沒有儲存的軌跡資料');
          }
        } catch (e) {
          console.error('解析軌跡資料失敗:', e);
        }
      }

      // Fallback: localStorage
      if (!lastTrackData) {
        try {
          const stored = localStorage.getItem('track_data');
          if (stored) {
            lastTrackData = JSON.parse(stored);
            console.log('從 localStorage 取得軌跡資料:', lastTrackData);
          }
        } catch (e) {
          console.error('從 localStorage 讀取失敗:', e);
        }
      }

      if (!lastTrackData || !lastTrackData.trackPoints || lastTrackData.trackPoints.length === 0) {
        console.warn('沒有可重送的軌跡資料');
        if (onShowMessage) {
          onShowMessage('沒有找到上次的軌跡記錄');
        }
        return;
      }

      // 檢查資料完整性
      if (!lastTrackData.screenshot) {
        console.warn('軌跡資料缺少截圖');
        if (onShowMessage) {
          onShowMessage('軌跡資料不完整，缺少截圖');
        }
        return;
      }

      console.log('上次軌跡資料:');
      console.log('- 點位數:', lastTrackData.trackPoints.length);
      console.log('- 電桿設備:', lastTrackData.poleDevices.length);
      console.log('- 其他設備:', lastTrackData.otherDevices.length);
      console.log('- 截圖:', lastTrackData.screenshot ? '有' : '無');

      if (onShowMessage) {
        onShowMessage('找到上次軌跡，開始重現...');
      }

      // 重置狀態
      trackPoints = [];
      warmupCount = 0;
      isTracking = true;
      isTestMode = true;    // 使用測試模式（跳過距離檢查）
      isResendMode = true;  // 重送模式（跳過預熱）

      console.log('✓ 重送模式啟用：跳過預熱檢查');

      if (onUpdateStatus) {
        onUpdateStatus('正在重現軌跡...');
      }

      if (onTrackingStarted) {
        onTrackingStarted();
      }

      // 使用座標字串格式重現軌跡
      const coordString = lastTrackData.trackPoints
        .map(pt => `${pt[0]},${pt[1]}`)
        .join(' ');

      console.log('座標字串:', coordString);

      // 使用測試座標模式逐點添加
      const coordPairs = coordString.trim().split(/\s+/);

      for (let index = 0; index < coordPairs.length; index++) {
        const pair = coordPairs[index];
        const [x, y] = pair.split(',').map(Number);

        if (!isNaN(x) && !isNaN(y)) {
          await new Promise(resolve => {
            setTimeout(async () => {
              if (isTracking) {
                addTrackPoint([x, y]);

                // 跟隨到該點（較慢的動畫）
                if (view) {
                  await view.goTo({
                    target: { x, y, spatialReference: { wkid: 3826 } },
                    zoom: view.zoom || 16
                  }, {
                    animate: true,
                    duration: 500  // 比測試座標慢一點
                  });
                }

                console.log(`重現點位 ${index + 1}/${coordPairs.length}: (${x}, ${y})`);
              }
              resolve();
            }, index * 1000);  // 每秒一個點
          });
        }
      }

      // 所有點添加完成後，等待一下再停止
      console.log('所有點位已重現，準備停止並重新分析...');

      await new Promise(resolve => setTimeout(resolve, 1500));

      if (onShowMessage) {
        onShowMessage('軌跡重現完成，正在分析...');
      }

      // 自動停止（會觸發截圖和空間查詢）
      if (window.autoStopTrackInspection) {
        window.autoStopTrackInspection();
      }
    },

    /**
     * 取得當前軌跡資料
     */
    getTrackData() {
      return {
        isTracking: isTracking,
        pointCount: trackPoints.length,
        warmupCount: warmupCount,
        poleDevices: poleDevices,
        otherDevices: otherDevices,
        deviceCounts: deviceCounts,
        screenshot: trackScreenshot
      };
    }
  };
})();

// 掛載到全域
if (typeof window !== 'undefined') {
  window.TrackInspectionModule = TrackInspectionModule;
  console.log('✓ TrackInspectionModule 已載入');
}