(function() {
  console.log('taoyuan-construction.js 開始執行');

  var API_LOGIN_URL = 'https://rmic.tycg.gov.tw/RMOutAPI/Auth/APILogin';
  var API_DATA_URL = 'https://rmic.tycg.gov.tw/RMOutAPI/Traffic/GetTodayWorkCaseDetail';
  var onShowMessage = null;
  var constructions = [];
  var view, map, Graphic, Point, Multipoint, Polyline, Polygon, TextSymbol, geometryEngine, FeatureLayer, GraphicsLayer, graphicsLayer, layerList, projection;
  var constructionGeomLayer = null;
  var authToken = null;
  var pipeLayerUrl = null;

  // ⭐ 海纜配管區相關變數
  var cableZoneLayerUrl = null;  // TYCG48 圖層 URL
  var cableZoneOids = [];         // G48TY OBJECTID 列表

  // 儲存 ArcGIS 類別的參考
  var ArcGISPoint, ArcGISMultipoint, ArcGISPolyline, ArcGISPolygon;

  function init(callbacks, arcgisModules) {
    onShowMessage = callbacks.onShowMessage || null;
    view = arcgisModules.view;
    map = arcgisModules.map;
    Graphic = arcgisModules.Graphic;
    Point = arcgisModules.Point;
    Multipoint = arcgisModules.Multipoint;
    Polyline = arcgisModules.Polyline;
    Polygon = arcgisModules.Polygon;
    TextSymbol = arcgisModules.TextSymbol;
    geometryEngine = arcgisModules.geometryEngine;
    FeatureLayer = arcgisModules.FeatureLayer;
    GraphicsLayer = arcgisModules.GraphicsLayer;
    layerList = arcgisModules.layerList;
    projection = arcgisModules.projection;

    // 儲存 ArcGIS 類別參考（避免被 JSON 的 polygon 物件覆蓋）
    ArcGISPoint = Point;
    ArcGISMultipoint = Multipoint;
    ArcGISPolyline = Polyline;
    ArcGISPolygon = Polygon;

    console.log('ArcGIS 類別檢查:');
    console.log('  Point:', typeof ArcGISPoint);
    console.log('  Multipoint:', typeof ArcGISMultipoint);
    console.log('  Polyline:', typeof ArcGISPolyline);
    console.log('  Polygon:', typeof ArcGISPolygon);

    // 建立專用的施工位置圖層
    if (!graphicsLayer) {
      graphicsLayer = new GraphicsLayer({ title: "桃園市施工位置" });
      map.add(graphicsLayer);
      console.log('建立施工位置圖層');
    }

    // 建立施工範圍圖層（Polygon / Line）
    if (!constructionGeomLayer) {
      constructionGeomLayer = new GraphicsLayer({ title: "施工範圍" });
      map.add(constructionGeomLayer);
      console.log('建立施工範圍圖層');
    }

    console.log('桃園市今日施工位置模組已初始化');
  }

  // 顯示訊息的輔助函數
  function showMessage(msg) {
    if (onShowMessage) {
      onShowMessage(msg);
    } else {
      console.log('訊息:', msg);
    }
  }

  // 步驟1: 登入取得 Token
  function login() {
    console.log('========================================');
    console.log('步驟1: 呼叫 Android 登入取得 Token');
    console.log('API URL:', API_LOGIN_URL);
    console.log('========================================');

    showMessage('正在登入...');

    if (window.Android && window.Android.loginTaoyuan) {
      window.Android.loginTaoyuan(API_LOGIN_URL);
    } else {
      console.error('❌ Android.loginTaoyuan 方法不存在');
      showMessage('錯誤：無法連接 Android 介面');
    }
  }

  // 接收 Android 回傳的 Token
  function receiveToken(token) {
    console.log('✓ 收到 Token:', token ? token.substring(0, 20) + '...' : 'null');

    if (!token) {
      console.error('❌ Token 為空');
      showMessage('登入失敗：Token 為空');
      return;
    }

    authToken = token;

    console.log('========================================');
    showMessage('登入成功，開始載入資料...');

    // 取得 Token 後，立即載入資料
    fetchConstructionData(token);
  }

  // 步驟2: 載入施工資料
  function fetchConstructionData(token) {
    console.log('========================================');
    console.log('步驟2: 呼叫 Android 載入施工資料');
    console.log('API URL:', API_DATA_URL);
    console.log('使用 Token:', token.substring(0, 20) + '...');
    console.log('請等待約 80 秒...');
    console.log('========================================');

    showMessage('載入施工資料中... (約需 80 秒)');

    if (window.Android && window.Android.fetchTaoyuanData) {
      window.Android.fetchTaoyuanData(API_DATA_URL, token);
    } else {
      console.error('❌ Android.fetchTaoyuanData 方法不存在');
      showMessage('錯誤：無法連接 Android 介面');
    }
  }

  // 解析施工資料
  function processConstructionData(data) {
    console.log('========================================');
    console.log('步驟3: 開始解析施工資料');
    console.log('總筆數:', data.length);
    console.log('========================================');

    // 再次檢查是否為空（雙重保險）
    if (!data || data.length === 0) {
      console.log('資料為空，顯示空訊息');
      showMessage('今日尚未有施工案件');
      constructions = [];
      if (window.showConstructionDistrictList) {
        window.showConstructionDistrictList(['全部行政區'], 'taoyuan');
      }
      return;
    }

    // 先顯示前 3 筆原始資料
    console.log('--- 原始資料範例（前3筆）---');
    for (var i = 0; i < Math.min(3, data.length); i++) {
      console.log('第', i + 1, '筆:');
      console.log('  CaseID:', data[i].CaseID);
      console.log('  Addtownship:', data[i].Addtownship);
      console.log('  SLocation:', data[i].SLocation);
      console.log('  Factory_Man:', data[i].Factory_Man, 'Factory_Man_Tel:', data[i].Factory_Man_Tel);
      console.log('  Supervise:', data[i].Supervise, 'Supervise_Tel:', data[i].Supervise_Tel);
      console.log('  CameraLink:', data[i].CameraLink);

      // ⭐ 顯示所有欄位，找出行政區的正確欄位名稱
      if (i === 0) {
        console.log('  ========');
        console.log('  📋 所有欄位:', Object.keys(data[i]).join(', '));
        console.log('  ========');
      }
      console.log('');
    }
    console.log('========================================');

    // ⭐ 過濾掉包含「孔蓋啟閉」的案件
    var originalCount = data.length;
    data = data.filter(function(item) {
      // 檢查所有欄位是否包含「孔蓋啟閉」
      var itemStr = JSON.stringify(item);
      var hasKeyword = itemStr.indexOf('孔蓋啟閉') !== -1;

      if (hasKeyword) {
        console.log('⊘ 排除案件（包含「孔蓋啟閉」）:', item.CaseID, '|', item.ConstName || item.SLocation || '');
      }

      return !hasKeyword;  // 不包含「孔蓋啟閉」的才保留
    });

    var filteredCount = originalCount - data.length;
    if (filteredCount > 0) {
      console.log('========================================');
      console.log('⊘ 已過濾', filteredCount, '筆包含「孔蓋啟閉」的案件');
      console.log('  原始筆數:', originalCount);
      console.log('  過濾後:', data.length);
      console.log('========================================');
    }

    // 再次檢查過濾後是否為空
    if (!data || data.length === 0) {
      console.log('過濾後資料為空，顯示空訊息');
      showMessage('今日尚未有需處理的施工案件（已排除孔蓋啟閉案件）');
      constructions = [];
      if (window.showConstructionDistrictList) {
        window.showConstructionDistrictList(['全部行政區'], 'taoyuan');
      }
      return;
    }

    constructions = data.map(function(item, index) {
      // 只顯示第一筆的詳細 log
      if (index === 0) {
        console.log('--- 第一筆詳細資料 ---');
      }

      // 桃園的資料沒有 properties 層，直接就是屬性
      var props = item;

      // 座標處理 - Shape 是字串格式 "經度,緯度" (WGS84)
      var x = 0, y = 0;
      if (props.Shape) {
        var coords = props.Shape.split(',');
        if (coords.length === 2) {
          x = parseFloat(coords[0]); // 經度
          y = parseFloat(coords[1]); // 緯度
        }
      }

      return {
        coordinates: { x: x, y: y },
        acNo: props.CaseID || '',
        appName: props.PPBName || '',
        cName: props.Addtownship || '',
        addr: props.SLocation || '',
        cbDa: props.Start || '',
        ceDa: props.stop || '',
        coTi: props.ConstTime || '',
        tcNa: props.Factory || '',
        tcMa: props.Supervise || '',          // ⭐ 修正：廠商窗口名稱
        tcTl: props.Supervise_Tel || '',
        tcMa3: props.Factory_Man || '',       // ⭐ 修正：現場人員名稱
        tcTl3: props.Factory_Man_Tel || '',
        nPurp: props.ConstName || '',
        wItem: props.UseTech || '',
        cameraLink: props.CameraLink || '',
        positions: props.Positions,
        positionsType: props.Positions_type,
        pipeCount: 0
      };
    });

    console.log('========================================');
    console.log('✓ 資料解析完成，共', constructions.length, '筆');
    if (constructions.length > 0) {
      console.log('第一筆資料:', constructions[0]);
      console.log('第一筆 cName:', constructions[0].cName);
      console.log('第一筆 cameraLink:', constructions[0].cameraLink);
    } else {
      console.error('❌ constructions 是空陣列！');
    }
    console.log('========================================');

    showMessage('載入完成：' + constructions.length + ' 筆施工資料');
    showDistrictMenu();
  }

  // 顯示行政區選單
  function showDistrictMenu() {
    console.log('========================================');
    console.log('showDistrictMenu 被呼叫');
    console.log('constructions 長度:', constructions.length);
    console.log('constructions 內容:', constructions.slice(0, 2));  // 顯示前兩筆
    console.log('========================================');

    var districts = {};
    constructions.forEach(function(c) {
      if (c.cName) districts[c.cName] = true;
    });
    var list = Object.keys(districts).sort();
    list.unshift('全部行政區');
    console.log('行政區清單:', list);

    // 傳給 map.html 顯示 Vue 清單
    if (window.showConstructionDistrictList) {
      window.showConstructionDistrictList(list, 'taoyuan');
    }
  }

  // 載入施工資料的主函數
  function loadConstructionData() {
    showMessage('開始載入桃園施工資料...');
    login();
  }

  // 接收 Android 回傳的施工資料
  function receiveConstructionData(data) {
    try {
      console.log('========================================');
      console.log('收到 Android 回傳的資料');
      console.log('資料類型:', typeof data);
      console.log('資料筆數:', Array.isArray(data) ? data.length : '非陣列');
      console.log('========================================');

      // 處理 undefined 或 null
      if (!data || data === 'undefined' || data === 'null') {
        console.log('========================================');
        console.log('✓ API 回傳成功，但今日無施工案件');
        console.log('========================================');
        showMessage('今日尚未有施工案件');

        constructions = [];

        if (window.showConstructionDistrictList) {
          window.showConstructionDistrictList(['全部行政區'], 'taoyuan');
        }

        return;
      }

      // 如果是字串，嘗試解析為 JSON
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch (parseError) {
          console.error('JSON 解析失敗:', parseError);
          throw new Error('JSON 格式錯誤：無法解析');
        }
      }

      if (!Array.isArray(data)) {
        console.log('資料內容:', JSON.stringify(data).substring(0, 500));
        throw new Error('JSON 格式錯誤：預期為陣列');
      }

      // 檢查是否為空陣列
      if (data.length === 0) {
        console.log('========================================');
        console.log('✓ API 回傳成功，但今日無施工案件');
        console.log('========================================');
        showMessage('今日尚未有施工案件');

        constructions = [];

        if (window.showConstructionDistrictList) {
          window.showConstructionDistrictList(['全部行政區'], 'taoyuan');
        }

        return;
      }

      console.log('✓ 找到', data.length, '筆施工資料');

      processConstructionData(data);

    } catch (error) {
      console.error('========================================');
      console.error('❌ 解析施工資料失敗');
      console.error('錯誤:', error.message);
      console.error('========================================');
      showMessage('解析資料失敗: ' + error.message);
    }
  }

  /**
   * 接收 Firebase 資料（供 Android 呼叫）
   */
  function receiveFirebaseData(data) {
    console.log('========================================');
    console.log('receiveFirebaseData 被呼叫');
    console.log('資料類型:', typeof data);
    console.log('========================================');

    try {
      var parsedData = null;

      if (typeof data === 'string') {
        if (data === '' || data === 'null' || data === 'undefined') {
          console.log('⚠️ Firebase 無資料');
          parsedData = {};
        } else {
          parsedData = JSON.parse(data);
          console.log('✓ Firebase 資料解析成功');
          console.log('  master:', parsedData.master);
          console.log('  owner:', parsedData.owner);
        }
      } else if (typeof data === 'object') {
        parsedData = data;
        console.log('✓ Firebase 資料已是物件');
      }

      // 呼叫等待中的 callback
      if (window._pendingFirebaseCallback) {
        console.log('✓ 呼叫 _pendingFirebaseCallback');
        window._pendingFirebaseCallback(parsedData || {});
      } else {
        console.warn('⚠️ 沒有等待中的 callback');
      }

    } catch (e) {
      console.error('❌ Firebase 資料解析失敗:', e);
      if (window._pendingFirebaseCallback) {
        window._pendingFirebaseCallback({});
      }
    }
  }

  // 註冊為全域函數（供 Android 呼叫）
  window.receiveFirebaseData = receiveFirebaseData;

  // 選擇行政區（暫時只顯示 log）
  function selectDistrict(district) {
    console.log('選擇行政區:', district);
    showMessage('處理中...');

    var filtered = district === '全部行政區'
      ? constructions
      : constructions.filter(function(c) { return c.cName === district; });

    console.log('篩選後:', filtered.length, '筆');

    var pending = filtered.length;
    if (pending === 0) {
      display([]);
      return;
    }

    filtered.forEach(function(c) {
      if (c.positions && c.positionsType) {

        var geom = createGeometry(c); // 建立施工 Polygon / Polyline

        if (geom) {
          console.log('✓ 建立 geometry 成功 | acNo:', c.acNo);

          queryPipe(geom, function(count) {
            c.pipeCount = count;

            // ⭐ 查詢海纜配管區交會
            queryCableZone(geom, c.acNo, function(cableCount) {
              c.cableZoneCount = cableCount;

              // 只有 count > 0 時，才存入 geom、撈 Firebase
              if (count > 0) {
                c.geom = geom;
                c.geomType = c.positionsType;

                // Firebase 撈資料
                var ref = window.db.ref("TY/RLIST/" + c.acNo);
                console.log('REDB已呼叫', ref);

                ref.once("value")
                  .then(function(snapshot) {
                    if (snapshot.exists()) {
                      var data = snapshot.val();

                    c.master   = data.MASTER   || "";
                    c.mphone   = data.MPHONE   || "";
                    c.ophone   = data.OPHONE   || "";
                    c.ophone2  = data.OPHONE2  || "";
                    c.owner    = data.OWNER    || "";
                    c.owner2   = data.OWNER2   || "";
                    c.smsSend  = data["SMS-send"] || "";
                    c.note     = data.Note     || "";
                    c.doneFlag = data.Doneflag || "";
                    c.firebaseData = data;
                  } else {
                    console.log("Firebase 無資料 - 開始建立新資料, Ac_no:", c.acNo);

                    // 取得 TYCAREA 圖層 URL
                    var tycAreaUrl = "";
                    if (window.Android && window.Android.getLayerUrl) {
                      tycAreaUrl = window.Android.getLayerUrl('TYCAREA');
                      console.log('取得 TYCAREA 圖層 URL:', tycAreaUrl);
                    } else {
                      console.error('無法取得 TYCAREA 圖層 URL');
                    }

                    if (tycAreaUrl && geom) {
                      console.log('開始與 TYCAREA 圖層交集查詢...');

                      var tycAreaLayer = new FeatureLayer({
                        url: tycAreaUrl
                        // Token 由 esriConfig 全域設定處理
                      });

                      tycAreaLayer.load().then(function() {
                        console.log('TYCAREA FeatureLayer 載入成功');

                        var query = tycAreaLayer.createQuery();
                        query.geometry = geom;
                        query.spatialRelationship = 'intersects';
                        query.returnGeometry = false;
                        query.outFields = ['CENTOFF'];

                        tycAreaLayer.queryFeatures(query).then(function(result) {
                          console.log('TYCAREA 交集查詢完成，找到:', result.features.length, '筆');

                          if (result.features.length > 0) {
                            var centoff = result.features[0].attributes.CENTOFF;
                            console.log('取得 CENTOFF:', centoff);

                            // 從 Firebase TY/CENTOFF 取得中心局資料
                            var centoffRef = window.db.ref("TY/CENTOFF/" + centoff);
                            console.log('查詢 Firebase TY/CENTOFF/' + centoff);

                            centoffRef.once("value").then(function(centoffSnapshot) {
                              if (centoffSnapshot.exists()) {
                                var centoffData = centoffSnapshot.val();
                                console.log('取得 CENTOFF 資料:', centoffData);

                                // 建立新的 RLIST 資料
                                var newRlistData = {
                                  Ac_no: c.acNo,
                                  Addr: c.addr,
                                  App_Name: c.appName,
                                  C_Name: c.cName,
                                  Cb_Da: c.cbDa,
                                  Ce_Da: c.ceDa,
                                  Co_Ti: c.coTi,
                                  Tc_Na: c.tcNa,
                                  Tc_Ma: c.tcMa,
                                  Tc_Tl: c.tcTl,
                                  Tc_Ma3: c.tcMa3,
                                  Tc_Tl3: c.tcTl3,
                                  NPurp: c.nPurp,
                                  WItem: c.wItem,
                                  workdaytime: c.cbDa + c.ceDa,
                                  workperiod: c.coTi,
                                  PipelineCount: count,
                                  wphone2: c.tcTl
                                };

                                // 將 CENTOFF 的所有屬性加入
                                for (var key in centoffData) {
                                  if (centoffData.hasOwnProperty(key)) {
                                    newRlistData[key] = centoffData[key];
                                  }
                                }

                                console.log('準備寫入 RLIST 新資料:', newRlistData);

                                // 寫入 Firebase
                                var newRlistRef = window.db.ref("TY/RLIST/" + c.acNo);
                                newRlistRef.set(newRlistData)
                                  .then(function() {
                                    console.log('✅ RLIST 新資料寫入成功, Ac_no:', c.acNo);

                                    c.master   = newRlistData.MASTER   || "";
                                    c.mphone   = newRlistData.MPHONE   || "";
                                    c.ophone   = newRlistData.OPHONE   || "";
                                    c.ophone2  = newRlistData.OPHONE2  || "";
                                    c.owner    = newRlistData.OWNER    || "";
                                    c.owner2   = newRlistData.OWNER2   || "";
                                    c.smsSend  = newRlistData["SMS-send"] || "";
                                    c.note     = newRlistData.Note     || "";
                                    c.doneFlag = newRlistData.Doneflag || "";
                                    c.firebaseData = newRlistData;

                                    if (--pending === 0) display(filtered);
                                  })
                                  .catch(function(err) {
                                    console.error('❌ RLIST 寫入失敗:', err);
                                    if (--pending === 0) display(filtered);
                                  });

                              } else {
                                console.log('⚠️ Firebase TY/CENTOFF/' + centoff + ' 無資料');
                                if (--pending === 0) display(filtered);
                              }
                            }).catch(function(err) {
                              console.error('❌ 查詢 CENTOFF 資料失敗:', err);
                              if (--pending === 0) display(filtered);
                            });

                          } else {
                            console.log('⚠️ 施工範圍與 TYCAREA 無交集');
                            if (--pending === 0) display(filtered);
                          }
                        }).catch(function(err) {
                          console.error('❌ TYCAREA 交集查詢失敗:', err);
                          if (--pending === 0) display(filtered);
                        });

                      }).catch(function(err) {
                        console.error('❌ TYCAREA FeatureLayer 載入失敗:', err);
                        if (--pending === 0) display(filtered);
                      });

                    } else {
                      console.log('⚠️ 無 TYCAREA URL 或無 geometry，跳過建立新資料');
                      if (--pending === 0) display(filtered);
                    }
                  }

                  if (--pending === 0) display(filtered);
                })
                .catch(function(err) {
                  console.error("Firebase 錯誤:", err);
                  if (--pending === 0) display(filtered);
                });

            } else {
              // count == 0 不做任何 geom / firebase 動作
              if (--pending === 0) display(filtered);
            }

            }); // ⭐ queryCableZone 結束
          }); // queryPipe 結束

        } else {
          if (--pending === 0) display(filtered);
        }

      } else {
        if (--pending === 0) display(filtered);
      }
    });
  }

  /**
   * 點位過濾函數 - 移除相近點位（距離 < 1）
   * 只有當點數 >= 10 時才進行過濾
   */
  function filterNearbyPoints(points) {
    if (!points || points.length === 0) return points;

    // ⭐ 如果點位數 < 10，不進行過濾
    if (points.length < 10) {
      console.log('點位過濾: 點數不足 10 點 (' + points.length + ' 點)，不進行過濾');
      return points;
    }

    var filtered = [points[0]]; // 保留第一個點

    for (var i = 1; i < points.length; i++) {
      var current = points[i];
      var last = filtered[filtered.length - 1];

      var dx = Math.abs(current[0] - last[0]);
      var dy = Math.abs(current[1] - last[1]);

      // 只有當 x 或 y 差距 >= 1 時才加入
      if (dx >= 1 || dy >= 1) {
        filtered.push(current);
      }
    }

    console.log('點位過濾: 原始', points.length, '點 → 過濾後', filtered.length, '點');
    return filtered;
  }

  /**
   * 建立幾何圖形（支援所有類型）
   */
  function createGeometry(construction) {
    try {
      var posType = construction.positionsType;
      var positions = construction.positions;

      if (!positions || !posType) {
        console.log('無 positions 或 positionsType');
        return null;
      }

      console.log('建立幾何:', posType, '| ArcGISPolygon:', typeof ArcGISPolygon);

      // Point - 單點 → 產生 0.5m buffer
      if (posType === 'Point') {
        if (!ArcGISPoint || !geometryEngine) {
          console.error('Point 類別或 geometryEngine 未載入');
          return null;
        }
        var point = new ArcGISPoint({
          x: positions[0],
          y: positions[1],
          spatialReference: {wkid: 3826}
        });

        // 產生 0.5 公尺 buffer
        var buffered = geometryEngine.buffer(point, 0.5, 'meters');
        console.log('Point 已轉換為 0.5m buffer Polygon');
        return buffered;
      }

      // MultiPoint - 多點 → 產生 0.5m buffer
      if (posType === 'MultiPoint') {
        if (!ArcGISMultipoint || !geometryEngine) {
          console.error('Multipoint 類別或 geometryEngine 未載入');
          return null;
        }
        // 過濾相近點位
        var filteredPoints = filterNearbyPoints(positions);
        var multipoint = new ArcGISMultipoint({
          points: filteredPoints,
          spatialReference: {wkid: 3826}
        });

        // 產生 0.5 公尺 buffer
        var buffered = geometryEngine.buffer(multipoint, 0.5, 'meters');
        console.log('MultiPoint 已轉換為 0.5m buffer Polygon');
        return buffered;
      }

      // LineString - 單線
      if (posType === 'LineString') {
        if (!ArcGISPolyline) {
          console.error('Polyline 類別未載入');
          return null;
        }
        var filteredPath = filterNearbyPoints(positions);
        return new ArcGISPolyline({
          paths: [filteredPath],
          spatialReference: {wkid: 3826}
        });
      }

      // MultiLineString - 多線
      if (posType === 'MultiLineString') {
        if (!ArcGISPolyline) {
          console.error('Polyline 類別未載入');
          return null;
        }
        // 過濾每條線的點位
        var filteredPaths = positions.map(function(path) {
          return filterNearbyPoints(path);
        });
        return new ArcGISPolyline({
          paths: filteredPaths,
          spatialReference: {wkid: 3826}
        });
      }

      // Polygon - 單多邊形
      if (posType === 'Polygon') {
        if (!ArcGISPolygon) {
          console.error('Polygon 類別未載入');
          return null;
        }

        console.log('========================================');
        console.log('🔍 Polygon 詳細資訊');
        console.log('原始 positions:', JSON.stringify(positions));
        console.log('rings 數量:', positions.length);

        if (positions[0]) {
          console.log('第一個 ring 點數:', positions[0].length);
          console.log('第一個 ring 前 3 點:', positions[0].slice(0, 3));

          // 計算範圍
          var minX = Infinity, minY = Infinity;
          var maxX = -Infinity, maxY = -Infinity;

          positions.forEach(function(ring) {
            ring.forEach(function(point) {
              minX = Math.min(minX, point[0]);
              minY = Math.min(minY, point[1]);
              maxX = Math.max(maxX, point[0]);
              maxY = Math.max(maxY, point[1]);
            });
          });

          var width = maxX - minX;
          var height = maxY - minY;

          console.log('Polygon 範圍 (TWD97):');
          console.log('  X: ', minX, '~', maxX, '(寬度:', width, 'm)');
          console.log('  Y: ', minY, '~', maxY, '(高度:', height, 'm)');
          console.log('  面積約:', (width * height).toFixed(2), 'm²');

          // ⭐ 檢查是否合理
          if (width > 10000 || height > 10000) {
            console.error('❌❌❌ Polygon 範圍異常大！寬度或高度超過 10 公里！');
            console.error('這可能導致查詢到大量幹管');
          } else if (width < 0.1 || height < 0.1) {
            console.warn('⚠️ Polygon 範圍非常小（< 0.1m），可能退化');
          } else {
            console.log('✓ Polygon 範圍看起來正常');
          }
        }

        // 過濾每個環的點位
        var filteredRings = positions.map(function(ring) {
          var filtered = filterNearbyPoints(ring);
          console.log('Ring 點數: 原始', ring.length, '→ 過濾後', filtered.length);

          // ⭐ 檢查過濾後是否還能形成有效多邊形
          if (filtered.length < 3) {
            console.error('❌ Ring 過濾後少於 3 個點，無法形成多邊形！');
            console.error('原始點:', ring);
            console.error('過濾後:', filtered);
          }

          return filtered;
        });

        var polygon = new ArcGISPolygon({
          rings: filteredRings,
          spatialReference: {wkid: 3826}
        });

        console.log('✓ Polygon 已建立');
        console.log('  type:', polygon.type);
        console.log('  rings count:', polygon.rings.length);
        if (polygon.extent) {
          console.log('  extent:', {
            xmin: polygon.extent.xmin,
            ymin: polygon.extent.ymin,
            xmax: polygon.extent.xmax,
            ymax: polygon.extent.ymax,
            width: polygon.extent.width,
            height: polygon.extent.height
          });
        }
        console.log('========================================');

        return polygon;
      }

      // MultiPolygon - 多多邊形
      if (posType === 'MultiPolygon') {
        if (!ArcGISPolygon) {
          console.error('Polygon 類別未載入');
          return null;
        }

        console.log('🔍 MultiPolygon 處理');
        console.log('polygons 數量:', positions.length);

        var rings = [];
        positions.forEach(function(poly, polyIndex) {
          console.log('Polygon', polyIndex, 'rings:', poly.length);
          poly.forEach(function(ring, ringIndex) {
            console.log('  Ring', ringIndex, '點數:', ring.length);
            var filteredRing = filterNearbyPoints(ring);
            console.log('  過濾後點數:', filteredRing.length);

            if (filteredRing.length < 3) {
              console.error('❌ Ring 過濾後少於 3 個點！');
            }

            rings.push(filteredRing);
          });
        });

        console.log('✓ 總共', rings.length, '個 rings');

        return new ArcGISPolygon({
          rings: rings,
          spatialReference: {wkid: 3826}
        });
      }

      console.warn('不支援的幾何類型:', posType);
      return null;

    } catch (e) {
      console.error('建立 geometry 失敗:', e);
    }
    return null;
  }

  /**
   * 查詢幹線管道
   */
  function queryPipe(geom, callback) {
    try {
      console.log('========================================');
      console.log('queryPipe 被呼叫');
      console.log('pipeLayerUrl:', pipeLayerUrl);
      console.log('pipeLayerUrl 類型:', typeof pipeLayerUrl);
      console.log('幾何類型:', geom.type);
      console.log('========================================');

      if (!pipeLayerUrl) {
        console.error('❌ 幹線管道 URL 未設定');
        console.error('請確認：');
        console.error('1. strings.xml 中有設定 TYG41');
        console.log('2. 點擊「桃園市今日施工位置」時有呼叫 setPipeLayerUrl');
        callback(0);
        return;
      }

      // ⭐ 重要：不再做 buffer！
      // Point/MultiPoint 在 createGeometry 時已經做過 0.5m buffer
      // Polygon/LineString 本身已經有範圍，不需要 buffer
      console.log('✓ 使用原始幾何查詢（Point/MultiPoint 已預先 buffer 過）');

      console.log('使用幹線管道 URL:', pipeLayerUrl);

      var featureLayer = new FeatureLayer({
        url: pipeLayerUrl
        // Token 由 esriConfig 全域設定處理
      });

      featureLayer.load().then(function() {
        console.log('FeatureLayer 載入成功');

        var query = featureLayer.createQuery();
        query.geometry = geom;  // ⭐ 直接使用幾何，不做 buffer
        query.spatialRelationship = 'intersects';
        query.returnGeometry = false;

        console.log('開始查詢幹管...');

        featureLayer.queryFeatureCount(query).then(function(count) {
          console.log('查詢完成，幹管數量:', count);
          callback(count);
        }).catch(function(err) {
          console.error('查詢失敗:', err.message || err);
          callback(0);
        });
      }).catch(function(err) {
        console.error('FeatureLayer 載入失敗:', err.message || err);
        callback(0);
      });

    } catch (e) {
      console.error('查詢異常:', e.message || e, e.stack);
      callback(0);
    }
  }

  /**
   * 直接使用 REST API 查詢海纜配管區（不用 FeatureLayer）
   * @param {Geometry} geom - 施工範圍幾何
   * @param {string} layerUrl - MapServer 圖層 URL
   * @param {Array<number>} oids - OBJECTID 列表
   * @param {string} acNo - 路證編號
   * @param {Function} callback - 回調函數
   */
  function queryCableZoneDirectly(geom, layerUrl, oids, acNo, callback) {
    try {
      console.log('🔍 使用直接 REST API 查詢海纜配管區');
      console.log('  圖層 URL:', layerUrl);

      // 建立查詢 URL（使用 query 端點）
      var queryUrl = layerUrl + '/query';

      // 將幾何轉換為查詢格式
      var wgs84Geom = null;
      var geometryType = '';

      console.log('  幾何類型:', geom.type);
      console.log('  幾何物件:', geom);

      if (geom.type === 'point') {
        // Point 使用 x, y
        wgs84Geom = {
          x: geom.x,
          y: geom.y,
          spatialReference: { wkid: 4326 }
        };
        geometryType = 'esriGeometryPoint';
        console.log('  ✓ 轉換為 Point:', wgs84Geom);
      } else if (geom.type === 'polygon') {
        // Polygon 使用 rings
        wgs84Geom = {
          rings: geom.rings,
          spatialReference: { wkid: 4326 }
        };
        geometryType = 'esriGeometryPolygon';
        console.log('  ✓ 轉換為 Polygon (rings 數量:', geom.rings ? geom.rings.length : 0, ')');
      } else if (geom.type === 'polyline') {
        // Polyline 使用 paths
        wgs84Geom = {
          paths: geom.paths,
          spatialReference: { wkid: 4326 }
        };
        geometryType = 'esriGeometryPolyline';
        console.log('  ✓ 轉換為 Polyline (paths 數量:', geom.paths ? geom.paths.length : 0, ')');
      }

      if (!wgs84Geom) {
        console.error('❌ 無法轉換幾何，不支援的類型:', geom.type);
        callback(0);
        return;
      }

      // 建立查詢參數
      var params = new URLSearchParams({
        f: 'json',
        geometry: JSON.stringify(wgs84Geom),
        geometryType: geometryType,
        spatialRel: 'esriSpatialRelIntersects',
        where: 'OBJECTID IN (' + oids.join(',') + ')',
        returnGeometry: 'false',
        returnCountOnly: 'true',
        outFields: '*'
      });

      var fullUrl = queryUrl + '?' + params.toString();
      console.log('========================================');
      console.log('🔍 準備發送 REST API 請求');
      console.log('  完整 URL:', fullUrl);
      console.log('========================================');

      // 發送請求
      fetch(fullUrl)
        .then(function(response) {
          console.log('📥 收到 HTTP 回應');
          console.log('  狀態碼:', response.status);
          console.log('  狀態文字:', response.statusText);
          console.log('  OK:', response.ok);

          if (!response.ok) {
            throw new Error('HTTP ' + response.status + ' ' + response.statusText);
          }
          return response.json();
        })
        .then(function(data) {
          console.log('========================================');
          console.log('📦 收到 JSON 資料');
          console.log('  完整回應:', JSON.stringify(data, null, 2));
          console.log('========================================');
          console.log('🌊 海纜配管區查詢完成（REST API）');
          console.log('  路證編號:', acNo);

          var count = data.count || 0;
          console.log('  ⭐ 交會數量:', count);

          // ⭐ 如果有交會，彈出告警視窗
          if (count > 0) {
            console.log('⚠️⚠️⚠️ 警告：發現海纜配管區交會！');
            console.log('  路證編號:', acNo);

            // 彈出告警視窗
            showCableZoneAlert(acNo);
          } else {
            console.log('✓ 無海纜配管區交會');
          }

          console.log('========================================');
          callback(count);
        })
        .catch(function(err) {
          console.error('========================================');
          console.error('❌ 海纜配管區 REST API 查詢失敗');
          console.error('  錯誤訊息:', err.message);
          console.error('  錯誤類型:', err.name);
          console.error('  錯誤堆疊:', err.stack);
          console.error('========================================');
          callback(0);
        });

    } catch (e) {
      console.error('❌ queryCableZoneDirectly 異常:', e.message || e);
      callback(0);
    }
  }

  /**
   * 查詢海纜配管區交會
   * @param {Geometry} geom - 施工範圍幾何
   * @param {string} acNo - 路證編號
   * @param {Function} callback - 回調函數
   */
  function queryCableZone(geom, acNo, callback) {
    try {
      console.log('========================================');
      console.log('🌊 queryCableZone 被呼叫');
      console.log('  路證編號:', acNo);
      console.log('  cableZoneLayerUrl:', cableZoneLayerUrl);
      console.log('  cableZoneOids:', cableZoneOids);
      console.log('========================================');

      // 檢查是否有設定圖層 URL 和 OBJECTID
      if (!cableZoneLayerUrl) {
        console.log('⚠️ 海纜配管區圖層 URL 未設定，跳過檢查');
        callback(0);
        return;
      }

      if (!cableZoneOids || cableZoneOids.length === 0) {
        console.log('⚠️ 海纜配管區 OBJECTID 列表為空，跳過檢查');
        callback(0);
        return;
      }

      console.log('✓ 開始查詢海纜配管區交會...');
      console.log('  目標 OBJECTID 數量:', cableZoneOids.length);
      console.log('  目標 OBJECTID:', cableZoneOids.join(', '));

      // ⭐ 使用直接的 REST API 查詢，不用 FeatureLayer
      // 因為 FeatureServer 可能不存在或需要特殊權限
      queryCableZoneDirectly(geom, cableZoneLayerUrl, cableZoneOids, acNo, callback);

    } catch (e) {
      console.error('❌ 海纜配管區查詢異常:', e.message || e, e.stack);
      callback(0);
    }
  }

  /**
   * 顯示海纜配管區告警視窗
   * @param {string} acNo - 路證編號
   */
  function showCableZoneAlert(acNo) {
    console.log('顯示海纜配管區告警視窗:', acNo);

    // 移除舊的告警視窗（如果存在）
    var existingAlert = document.getElementById("cableZoneAlert");
    if (existingAlert) {
      existingAlert.remove();
    }

    // 建立遮罩
    var mask = document.createElement("div");
    mask.id = "cableZoneAlert";
    mask.style.position = "fixed";
    mask.style.left = "0";
    mask.style.top = "0";
    mask.style.width = "100vw";
    mask.style.height = "100vh";
    mask.style.background = "rgba(0,0,0,0.6)";
    mask.style.display = "flex";
    mask.style.justifyContent = "center";
    mask.style.alignItems = "center";
    mask.style.zIndex = "99999";

    // 建立告警框
    var alertBox = document.createElement("div");
    alertBox.style.width = "320px";
    alertBox.style.background = "#fff";
    alertBox.style.borderRadius = "10px";
    alertBox.style.boxShadow = "0 4px 10px rgba(0,0,0,0.3)";
    alertBox.style.padding = "20px";
    alertBox.style.fontFamily = "Arial, sans-serif";
    alertBox.style.border = "3px solid #ff4444";

    alertBox.innerHTML = `
      <div style="text-align: center;">
        <div style="font-size: 48px; margin-bottom: 10px;">⚠️</div>
        <h3 style="margin: 0 0 15px 0; color: #ff4444; font-size: 18px;">海纜配管區警告</h3>
        <p style="margin: 0 0 10px 0; font-size: 14px; color: #333;">
          路證編號：<strong>${acNo}</strong>
        </p>
        <p style="margin: 0 0 20px 0; font-size: 15px; color: #ff4444; font-weight: bold;">
          在海纜配管區有申挖！<br>請注意！
        </p>
        <button id="btnCloseCableAlert"
                style="width: 100%; padding: 10px; border: none; border-radius: 6px;
                       background: #ff4444; color: #fff; font-weight: bold; cursor: pointer; font-size: 14px;">
          我知道了
        </button>
      </div>
    `;

    mask.appendChild(alertBox);
    document.body.appendChild(mask);

    // 綁定關閉按鈕
    document.getElementById("btnCloseCableAlert").onclick = function() {
      mask.remove();
    };

    // 點擊遮罩也可關閉
    mask.onclick = function(e) {
      if (e.target === mask) {
        mask.remove();
      }
    };
  }

  /**
   * 設定幹線管道 URL
   */
  function setPipeLayerUrl(url) {
    console.log('========================================');
    console.log('setPipeLayerUrl 被呼叫');
    console.log('接收到的 URL:', url);
    console.log('URL 類型:', typeof url);
    console.log('URL 長度:', url ? url.length : 0);
    console.log('========================================');

    pipeLayerUrl = url;
    console.log('設定幹線管道 URL:', pipeLayerUrl);
  }

  /**
   * 設定海纜配管區圖層 URL 和 OBJECTID 列表
   * @param {string} url - TYCG48 圖層 URL
   * @param {string} oidString - G48TY OBJECTID 字串（逗號分隔，例如："271390,266984"）
   */
  function setCableZoneConfig(url, oidString) {
    console.log('========================================');
    console.log('🌊 setCableZoneConfig 被呼叫');
    console.log('  接收到的 URL:', url);
    console.log('  接收到的 OBJECTID 字串:', oidString);
    console.log('========================================');

    cableZoneLayerUrl = url;

    // 解析 OBJECTID 字串為陣列
    if (oidString && oidString.trim() !== '') {
      // 分割字串，移除空白，轉為整數
      cableZoneOids = oidString.split(',')
        .map(function(s) { return parseInt(s.trim(), 10); })
        .filter(function(n) { return !isNaN(n); });

      console.log('✓ 解析後的 OBJECTID 列表:', cableZoneOids);
      console.log('  共', cableZoneOids.length, '個 OBJECTID');
    } else {
      cableZoneOids = [];
      console.log('⚠️ OBJECTID 字串為空');
    }

    console.log('========================================');
    console.log('海纜配管區設定完成:');
    console.log('  圖層 URL:', cableZoneLayerUrl);
    console.log('  OBJECTID:', cableZoneOids);
    console.log('========================================');
  }

  /**
   * 顯示施工點位在地圖上
   */
  function display(list) {
    console.log('開始顯示施工點');

    if (!graphicsLayer || !view) return;

    graphicsLayer.removeAll();
    if (constructionGeomLayer) {
      constructionGeomLayer.removeAll();
    }

    var points3826 = [];
    var displayed = 0;

    list.forEach(function(c) {
      // ⭐ 只收集有幹管交集的施工點 (pipeCount > 0)
      if (c.pipeCount > 0 && c.coordinates && c.coordinates.x && c.coordinates.y) {
        points3826.push({
          x: c.coordinates.x,
          y: c.coordinates.y,
          construction: c
        });
      }
    });

    if (points3826.length === 0) {
      showMessage('無符合條件的施工位置（無幹管交集）');
      return;
    }

    console.log('準備顯示', points3826.length, '個有幹管交集的點位');

    // 轉換座標並顯示
    points3826.forEach(function(p) {
      var point = {
        type: "point",
        x: p.x,
        y: p.y,
        spatialReference: { wkid: 4326 } // WGS84
      };

      // ⭐ Firebase 狀態判斷
      var hasDone = p.construction.doneFlag && p.construction.doneFlag.trim() !== "";
      var hasNote = p.construction.note && p.construction.note.trim() !== "";
      var isFinished = hasDone || hasNote;

      // ⭐ marker 顏色：藍色=已處理，紅色=未處理
      var markerSymbol = {
        type: "simple-marker",
        color: isFinished
          ? [0, 102, 204, 0.85]   // 🔵 藍色 - 已處理
          : [220, 53, 69, 0.85],  // 🔴 紅色 - 未處理
        size: 18,
        outline: {
          color: [255, 255, 255],
          width: 2
        }
      };

      // 顯示幹管數量的文字標籤
      var textSymbol = {
        type: "text",
        text: String(p.construction.pipeCount),
        color: "white",
        font: {
          size: 12,
          weight: "bold"
        },
        yoffset: 0
      };

      // 加入 marker 圖形
      graphicsLayer.add(new Graphic({
        geometry: point,
        symbol: markerSymbol,
        attributes: p.construction
      }));

      // 加入文字標籤
      graphicsLayer.add(new Graphic({
        geometry: point,
        symbol: textSymbol
      }));

      displayed++;
    });

    console.log('✓ 已顯示', displayed, '個有幹管交集的施工位置');
    showMessage('顯示 ' + displayed + ' 個有幹管交集的施工位置');

    // ⭐ Zoom to extent（所有點位的範圍）
    if (points3826.length === 0) {
      console.log('沒有點位，跳過 zoom');
      return;
    }

    console.log('========================================');
    console.log('開始計算 extent，點位數量:', points3826.length);

    // 使用 WGS84 座標計算 extent
    var xmin = points3826[0].x;
    var xmax = points3826[0].x;
    var ymin = points3826[0].y;
    var ymax = points3826[0].y;

    points3826.forEach(function(pt) {
      xmin = Math.min(xmin, pt.x);
      xmax = Math.max(xmax, pt.x);
      ymin = Math.min(ymin, pt.y);
      ymax = Math.max(ymax, pt.y);
    });

    console.log('WGS84 範圍:');
    console.log('  經度:', xmin, '~', xmax);
    console.log('  緯度:', ymin, '~', ymax);

    // 增加 20% 邊界，最少 0.005 度
    var dx = Math.max((xmax - xmin) * 0.2, 0.005);
    var dy = Math.max((ymax - ymin) * 0.2, 0.005);

    console.log('邊界增量 (度): dx:', dx, 'dy:', dy);

    // 建立 WGS84 extent 物件
    var extent4326 = {
      type: "extent",
      xmin: xmin - dx,
      ymin: ymin - dy,
      xmax: xmax + dx,
      ymax: ymax + dy,
      spatialReference: { wkid: 4326 }
    };

    console.log('WGS84 extent:', extent4326);

    if (!projection) {
      console.error('projection 模組未載入');
      return;
    }

    console.log('開始載入 projection...');

    projection.load().then(function() {
      console.log('projection 載入成功');
      console.log('view.spatialReference:', view.spatialReference);

      // 如果 view 已經是 WGS84，就不需要轉換
      if (view.spatialReference.wkid === 4326 || view.spatialReference.wkid === 4490) {
        console.log('view 已經是 WGS84，直接 zoom');

        view.goTo(extent4326, { duration: 1000 })
          .then(function() {
            console.log('✓ Zoom 成功');
            console.log('========================================');
          })
          .catch(function(err) {
            console.error('❌ Zoom 失敗:', err);
            console.log('========================================');
          });
      } else {
        // 需要轉換座標系統
        console.log('需要轉換座標系統，從 4326 到', view.spatialReference.wkid);

        var projectedExtent = projection.project(
          extent4326,
          view.spatialReference
        );

        if (!projectedExtent) {
          console.error('❌ Extent 投影失敗', extent4326);
          return;
        }

        console.log('投影後 extent:', projectedExtent);
        console.log('執行 view.goTo...');

        view.goTo(projectedExtent, { duration: 1000 })
          .then(function() {
            console.log('✓ Zoom 成功');
            console.log('========================================');
          })
          .catch(function(err) {
            console.error('❌ Zoom 失敗:', err);
            console.log('========================================');
          });
      }
    }).catch(function(err) {
      console.error('❌ projection 載入失敗:', err);
      console.log('========================================');
    });

    // 設定點擊處理
    setupClickHandler();
  }

  /**
   * 設定點擊處理函數
   */
  function setupClickHandler() {
    if (!view) {
      console.error('❌ view 不存在，無法設定點擊處理');
      return;
    }

    console.log('========================================');
    console.log('✓ 設定施工點點擊處理');
    console.log('========================================');

    // 移除舊的處理器（避免重複綁定）
    if (window._taoyuanClickHandler) {
      console.log('移除舊的點擊處理器');
      window._taoyuanClickHandler.remove();
    }

    window._taoyuanClickHandler = view.on('click', function(event) {
      console.log('========================================');
      console.log('地圖被點擊');
      console.log('點擊位置:', event.mapPoint);

      view.hitTest(event).then(function(response) {
        console.log('hitTest 結果:', response.results.length, '個物件');

        if (response.results.length > 0) {
          // 列出所有被點擊的物件
          response.results.forEach(function(result, index) {
            console.log('物件', index, ':', result.graphic);
            if (result.graphic && result.graphic.attributes) {
              console.log('  attributes:', result.graphic.attributes);
              console.log('  有 acNo?', !!result.graphic.attributes.acNo);
              console.log('  🔍 cameraLink:', result.graphic.attributes.cameraLink);  // ⭐ 加入 debug
            }
          });

          // 檢查是否點到施工點
          for (var i = 0; i < response.results.length; i++) {
            var result = response.results[i];
            if (result.graphic && result.graphic.attributes && result.graphic.attributes.acNo) {
              console.log('✓ 點到施工點，顯示彈窗');
              console.log('施工點資料:', result.graphic.attributes);
              console.log('========================================');
              showPopup(result.graphic.attributes, event.mapPoint);
              return;  // 找到就停止
            }
          }

          console.log('⚠️ 沒有點到施工點');
          console.log('========================================');
        } else {
          console.log('⚠️ hitTest 沒有結果');
          console.log('========================================');
        }
      }).catch(function(err) {
        console.error('❌ hitTest 失敗:', err);
        console.log('========================================');
      });
    });

    console.log('✓ 點擊處理器已設定');
  }

  /**
   * 顯示 Popup 和施工範圍
   */
  /**
   * TWD97 轉 WGS84 座標
   */
  function twd97ToWGS84(x, y) {
    var a = 6378137.0;
    var b = 6356752.314245;
    var lng0 = 121 * Math.PI / 180;
    var k0 = 0.9999;
    var dx = 250000;
    var dy = 0;

    x -= dx;
    y -= dy;

    var e = Math.sqrt(1 - Math.pow(b, 2) / Math.pow(a, 2));
    var M = y / k0;

    var mu = M / (a * (1 - Math.pow(e, 2) / 4 - 3 * Math.pow(e, 4) / 64 - 5 * Math.pow(e, 6) / 256));

    var e1 = (1 - Math.sqrt(1 - Math.pow(e, 2))) / (1 + Math.sqrt(1 - Math.pow(e, 2)));

    var J1 = 3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32;
    var J2 = 21 * Math.pow(e1, 2) / 16 - 55 * Math.pow(e1, 4) / 32;
    var J3 = 151 * Math.pow(e1, 3) / 96;
    var J4 = 1097 * Math.pow(e1, 4) / 512;

    var fp = mu + J1 * Math.sin(2 * mu) + J2 * Math.sin(4 * mu) +
             J3 * Math.sin(6 * mu) + J4 * Math.sin(8 * mu);

    var C1 = Math.pow(e, 2) * Math.pow(Math.cos(fp), 2) / (1 - Math.pow(e, 2));
    var T1 = Math.pow(Math.tan(fp), 2);
    var R1 = a * (1 - Math.pow(e, 2)) / Math.pow(1 - Math.pow(e, 2) * Math.pow(Math.sin(fp), 2), 1.5);
    var N1 = a / Math.sqrt(1 - Math.pow(e, 2) * Math.pow(Math.sin(fp), 2));
    var D = x / (N1 * k0);

    var lat = fp - (N1 * Math.tan(fp) / R1) *
      (Math.pow(D, 2) / 2 -
       (5 + 3 * T1 + 10 * C1 - 4 * Math.pow(C1, 2) - 9 * Math.pow(e, 2)) * Math.pow(D, 4) / 24 +
       (61 + 90 * T1 + 298 * C1 + 45 * Math.pow(T1, 2) - 252 * Math.pow(e, 2) - 3 * Math.pow(C1, 2)) * Math.pow(D, 6) / 720);

    var lng = lng0 + (D -
      (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6 +
      (5 - 2 * C1 + 28 * T1 - 3 * Math.pow(C1, 2) + 8 * Math.pow(e, 2) + 24 * Math.pow(T1, 2)) * Math.pow(D, 5) / 120) / Math.cos(fp);

    return {
      lat: lat * 180 / Math.PI,
      lng: lng * 180 / Math.PI
    };
  }

  /**
   * 取得使用者位置（支援測試模式）
   */
  function getUserLocation(callback, errorCallback) {
    try {
      // 優先使用測試 GPS 點位
      if (window.Android && window.Android.getGpsPoint) {
        var gpsStr = window.Android.getGpsPoint();
        console.log("DEBUG 模擬 GPS (TWD97):", gpsStr);

        if (gpsStr && gpsStr.includes(",")) {
          var arr = gpsStr.split(",");
          var x = parseFloat(arr[0]);
          var y = parseFloat(arr[1]);

          if (!isNaN(x) && !isNaN(y)) {
            var wgs = twd97ToWGS84(x, y);
            console.log("使用模擬 GPS → WGS84:", wgs);
            callback(wgs.lat, wgs.lng);
            return;
          }
        }
      }
    } catch (e) {
      console.warn("模擬 GPS 失敗，改用實際 GPS", e);
    }

    // 使用實際 GPS
    if (!navigator.geolocation) {
      errorCallback("裝置不支援定位");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      function(pos) {
        console.log("實際 GPS:", pos.coords.latitude, pos.coords.longitude);
        callback(pos.coords.latitude, pos.coords.longitude);
      },
      function(err) {
        errorCallback("定位失敗：" + err.message);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  /**
   * 計算兩點距離（公尺）
   */
  function calcDistanceMeter(lat1, lng1, lat2, lng2) {
    var R = 6378137; // 地球半徑（公尺）
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;

    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);

    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * 更新單一點位的顏色（當 Firebase 資料更新後）
   * @param {Object} attrs - 施工點位屬性
   */
  function updatePointColor(attrs) {
    try {
      console.log('========================================');
      console.log('🔄 updatePointColor - 更新點位顏色');
      console.log('  acNo:', attrs.acNo);
      console.log('  note:', attrs.note);
      console.log('  doneFlag:', attrs.doneFlag);
      console.log('========================================');

      if (!graphicsLayer) {
        console.error('❌ graphicsLayer 不存在');
        return;
      }

      // 找到對應的 marker graphic
      var markerGraphic = null;
      graphicsLayer.graphics.forEach(function(g) {
        if (g.attributes && g.attributes.acNo === attrs.acNo && g.symbol.type === 'simple-marker') {
          markerGraphic = g;
        }
      });

      if (!markerGraphic) {
        console.warn('⚠️ 找不到對應的 marker graphic');
        return;
      }

      // ⭐ 判斷是否已處理
      var hasDone = attrs.doneFlag && attrs.doneFlag.trim() !== "";
      var hasNote = attrs.note && attrs.note.trim() !== "";
      var isFinished = hasDone || hasNote;

      console.log('  hasDone:', hasDone);
      console.log('  hasNote:', hasNote);
      console.log('  isFinished:', isFinished);

      // 新的顏色
      var newColor = isFinished
        ? [0, 102, 204, 0.85]   // 🔵 藍色 - 已處理
        : [220, 53, 69, 0.85];  // 🔴 紅色 - 未處理

      // 建立新的 symbol
      var newSymbol = {
        type: "simple-marker",
        color: newColor,
        size: 18,
        outline: {
          color: [255, 255, 255],
          width: 2
        }
      };

      // 更新 graphic 的 symbol
      markerGraphic.symbol = newSymbol;

      console.log('✓ 點位顏色已更新為:', isFinished ? '藍色（已處理）' : '紅色（未處理）');
      console.log('========================================');

    } catch (e) {
      console.error('❌ updatePointColor 錯誤:', e);
    }
  }

  /**
   * 顯示點位詳細資訊彈窗
   */
  function showPopup(attrs, mapPoint) {
    console.log('========================================');
    console.log('showPopup 被呼叫');
    console.log('attrs:', attrs);
    console.log('mapPoint:', mapPoint);
    console.log('🔍 cameraLink 檢查:');
    console.log('  attrs.cameraLink:', attrs.cameraLink);
    console.log('  type:', typeof attrs.cameraLink);
    console.log('  有值?', !!attrs.cameraLink);
    console.log('  trim 後有值?', attrs.cameraLink && attrs.cameraLink.trim() !== '');
    console.log('========================================');

    if (!view || !view.popup) {
      console.error('view 或 view.popup 不存在');
      return;
    }

    var content = '<div style="padding:10px">' +
      '<div><b>路證編號：</b>' + (attrs.acNo || '') + '</div>' +
      '<div><b>施工單位：</b>' + (attrs.appName || '') + '</div>' +
      '<div><b>行政區：</b>' + (attrs.cName || '') + '</div>' +
      '<div><b>地點：</b>' + (attrs.addr || '') + '</div>' +
      '<div><b>施工起始：</b>' + (attrs.cbDa || '') + '</div>' +
      '<div><b>施工完成：</b>' + (attrs.ceDa || '') + '</div>' +
      '<div><b>施工時間：</b>' + (attrs.coTi || '') + '</div>' +
      '<div><b>施工廠商：</b>' + (attrs.tcNa || '') + '</div>' +
      '<div><b>廠商窗口：</b>' + (attrs.tcMa || '') + ' ' + (attrs.tcTl || '') + '</div>' +
      '<div><b>現場人員：</b>' + (attrs.tcMa3 || '') + ' ' + (attrs.tcTl3 || '') + '</div>' +
      '<div><b>施工目的：</b>' + (attrs.nPurp || '') + '</div>' +
      '<div><b>工項：</b>' + (attrs.wItem || '') + '</div>' +
      '<div><b>幹管數量：</b>' + (attrs.pipeCount || 0) + '</div>' +
      '<div><b>巡勘備註：</b>' + (attrs.note || '') + '</div>' +
      '<div><b>巡勘日期：</b>' + (attrs.doneFlag || '') + '</div>' +
      '<div><b>簡訊發送時間：</b>' + (attrs.smsSend || '') + '</div>' +
      '</div>';

    console.log('準備打開 popup');

    try {
      // 確保 popup 可見（參考台北模組）
      view.popup.autoCloseEnabled = false;
      view.popup.dockEnabled = true;
      view.popup.dockOptions = {
        buttonEnabled: false,
        breakpoint: false
      };

      view.popup.open({
        title: '桃園市施工資訊',
        content: content,
        location: mapPoint,
        visible: true
      });

      console.log('popup.open 已呼叫');
      console.log('popup.visible:', view.popup.visible);

      // 強制顯示（參考台北模組）
      setTimeout(function() {
        if (!view.popup.visible) {
          console.log('popup 不可見，嘗試重新開啟');
          view.popup.visible = true;
        }
        console.log('強制檢查後 popup.visible:', view.popup.visible);
      }, 100);

      // ⭐ 加入 Firebase action 按鈕
      if (!view.popup.actions.find(function(a) { return a.id === "firebase-action"; })) {
        view.popup.actions.push({
          title: "Firebase 資料",
          id: "firebase-action",
          className: "esri-icon-table"
        });
      }

      // ⭐ 加入「股長代理設定」action 按鈕
      if (!view.popup.actions.find(function(a) { return a.id === "deputy-action"; })) {
        view.popup.actions.push({
          title: "股長代理設定",
          id: "deputy-action",
          className: "esri-icon-user"
        });
      }

      // ⭐ 如果有攝影機連結，加入攝影機 action 按鈕
      if (attrs.cameraLink && attrs.cameraLink.trim() !== '') {
        console.log('✅ 有 cameraLink，加入攝影機 action');

        // 先移除舊的（避免重複）
        var existingIndex = view.popup.actions.findIndex(function(a) { return a.id === "camera-action"; });
        if (existingIndex !== -1) {
          view.popup.actions.splice(existingIndex, 1);
        }

        // 加入新的攝影機 action
        view.popup.actions.push({
          title: "現場監視器",
          id: "camera-action",
          className: "esri-icon-media"  // 使用媒體圖示
        });

        console.log('✓ 攝影機 action 已加入');
      } else {
        console.log('ℹ️ 無 cameraLink，不加入攝影機 action');
      }

      // 如果有施工範圍，顯示在地圖上
      if (attrs.geom && constructionGeomLayer) {
        console.log('準備顯示施工範圍');

        // 清除舊的施工範圍
        constructionGeomLayer.removeAll();

        var geomSymbol = null;
        var geomType = attrs.geomType || attrs.positionsType;

        console.log('施工範圍類型:', geomType);

        // 根據不同幾何類型設定不同符號
        if (geomType === 'MultiPolygon' || geomType === 'Polygon') {
          geomSymbol = {
            type: "simple-fill",
            color: [0, 0, 255, 0.2],  // 半透明藍色
            outline: {
              color: [0, 0, 255],
              width: 2
            }
          };
        } else if (geomType === 'Point') {
          geomSymbol = {
            type: "simple-fill",
            color: [255, 165, 0, 0.3],
            outline: {
              color: [255, 165, 0],
              width: 2
            }
          };
        } else if (geomType === 'MultiPoint') {
          geomSymbol = {
            type: "simple-fill",
            color: [255, 255, 0, 0.3],
            outline: {
              color: [255, 255, 0],
              width: 2
            }
          };
        } else if (geomType === 'MultiLineString' || geomType === 'LineString') {
          geomSymbol = {
            type: "simple-line",
            color: [0, 0, 255],
            width: 3
          };
        }

        if (geomSymbol) {
          var geomGraphic = new Graphic({
            geometry: attrs.geom,
            symbol: geomSymbol
          });

          constructionGeomLayer.add(geomGraphic);
          console.log('✓ 施工範圍已繪製');

          // 縮放到施工範圍
          view.goTo(attrs.geom)
            .then(function() {
              console.log('✓ 縮放到施工範圍成功');
            })
            .catch(function(err) {
              console.error('❌ 縮放到施工範圍失敗:', err);
            });
        }
      } else {
        console.warn('⚠️ 此筆資料沒有 geom，無法畫範圍');
        console.log('attrs.geom:', attrs.geom);
        console.log('constructionGeomLayer:', constructionGeomLayer);
      }

      // ⭐ 處理 Firebase action 按鈕點擊
      setupFirebaseActionHandler(attrs);

    } catch (e) {
      console.error('❌ 顯示 popup 失敗:', e);
      console.error('錯誤堆疊:', e.stack);
    }
  }

  /**
   * 設定 Firebase Action 按鈕的處理函數
   */
  function setupFirebaseActionHandler(attrs) {
    // 移除舊的事件處理器
    if (window._taoyuanFirebaseHandler) {
      window._taoyuanFirebaseHandler.remove();
    }

    // 設定新的事件處理器
    window._taoyuanFirebaseHandler = view.popup.on("trigger-action", function(event) {
      console.log("Popup action 被觸發:", event.action.id);

      if (event.action.id === "firebase-action") {
        console.log("Firebase Action 被點擊");
        showFirebaseDialog(attrs);
      } else if (event.action.id === "deputy-action") {
        console.log("👤 股長代理設定 Action 被點擊");
        showDeputySettingDialog(attrs);
      } else if (event.action.id === "camera-action") {
        console.log("📹 攝影機 Action 被點擊");
        console.log("  URL:", attrs.cameraLink);

        // 開啟攝影機連結
        if (attrs.cameraLink && attrs.cameraLink.trim() !== '') {
          if (window.Android && window.Android.openBrowser) {
            window.Android.openBrowser(attrs.cameraLink);
            console.log('✓ 已呼叫 Android.openBrowser');
          } else if (window.Android && window.Android.openURL) {
            window.Android.openURL(attrs.cameraLink);
            console.log('✓ 已呼叫 Android.openURL');
          } else {
            window.open(attrs.cameraLink, '_blank');
            console.log('✓ 已使用 window.open');
          }
        } else {
          console.error('❌ cameraLink 無效');
        }
      }
    });
  }

  /**
   * 顯示 Firebase 對話框（巡勘備註、導航、打卡、簡訊）
   */
  function showFirebaseDialog(attrs) {
    // 如果 dialog 已存在就不重複建立
    if (document.getElementById("firebaseDialog")) {
      console.log('對話框已存在');
      return;
    }

    var mask = document.createElement("div");
    mask.id = "firebaseDialogMask";
    mask.style.position = "fixed";
    mask.style.left = "0";
    mask.style.top = "0";
    mask.style.width = "100vw";
    mask.style.height = "100vh";
    mask.style.background = "rgba(0,0,0,0.5)";
    mask.style.display = "flex";
    mask.style.justifyContent = "center";
    mask.style.alignItems = "center";
    mask.style.zIndex = "99999";

    var dialog = document.createElement("div");
    dialog.id = "firebaseDialog";
    dialog.style.width = "320px";
    dialog.style.background = "#fff";
    dialog.style.borderRadius = "10px";
    dialog.style.boxShadow = "0 4px 10px rgba(0,0,0,0.3)";
    dialog.style.padding = "16px";
    dialog.style.fontFamily = "Arial, sans-serif";

    dialog.innerHTML = `
      <h3 style="margin-top:0;">施工巡勘功能</h3>

      <label style="font-weight: bold;">填寫巡勘備註：</label>
      <textarea id="surveyNote"
        style="width:100%; height:80px; margin-top:6px; margin-bottom:12px; padding:6px; border-radius:6px; border:1px solid #ccc;">
      </textarea>

      <button id="btnSubmitNote"
        style="width:100%; padding:10px; margin-bottom:10px; border:none; border-radius:6px; background:#0d6efd; color:#fff;">
        送出巡勘備註
      </button>

      <button id="btnNavigate"
        style="width:100%; padding:10px; margin-bottom:10px; border:none; border-radius:6px; background:#3f72af; color:#fff;">
        導航至施工處
      </button>

      <button id="btnCheckin"
        style="width:100%; padding:10px; margin-bottom:10px; border:none; border-radius:6px; background:#198754; color:#fff;">
        巡勘打卡
      </button>

      <button id="btnSms"
        style="width:100%; padding:10px; margin-bottom:10px; border:none; border-radius:6px; background:#f57c00; color:#fff;">
        發送簡訊
      </button>

      <button id="btnCloseDialog"
        style="width:100%; padding:10px; border:none; border-radius:6px; background:#757575; color:#fff;">
        關閉
      </button>
    `;

    mask.appendChild(dialog);
    document.body.appendChild(mask);

    // 設定初始值
    document.getElementById("surveyNote").value = (attrs.note || "");

    // 送出巡勘備註
    document.getElementById("btnSubmitNote").onclick = function() {
      var noteText = document.getElementById("surveyNote").value.trim();

      if (!noteText) {
        showMessage("請先填寫巡勘備註");
        return;
      }

      console.log("準備寫入 Firebase Note:", noteText);

      var ref = window.db.ref("TY/RLIST/" + attrs.acNo + "/Note");

      ref.set(noteText)
        .then(function() {
          console.log("Firebase Note 更新成功:", noteText);
          showMessage("巡勘備註已送出！");

          // 立即同步更新 attrs
          attrs.note = noteText;

          // ⭐ 重新繪製點位顏色（紅色 → 藍色）
          updatePointColor(attrs);
        })
        .catch(function(err) {
          console.error("Firebase 寫入失敗:", err);
          showMessage("儲存失敗，請稍後再試");
        });
    };

    // 導航功能
    document.getElementById("btnNavigate").onclick = function() {
      console.log("導航功能啟動");

      try {
        if (!attrs.coordinates || !attrs.coordinates.x || !attrs.coordinates.y) {
          showMessage("座標資料不完整");
          return;
        }

        // 桃園的座標已經是 WGS84 (經緯度)，不需要轉換
        var lon = attrs.coordinates.x;  // 經度
        var lat = attrs.coordinates.y;  // 緯度

        console.log("WGS84 座標:", lat, lon);
        console.log("路證編號:", attrs.acNo);

        // 使用台北相同的 Android 方法
        if (window.Android && window.Android.navigateToLocation) {
          console.log("呼叫 Android.navigateToLocation:", lat, lon, attrs.acNo);
          window.Android.navigateToLocation(lat, lon, attrs.acNo);
          showMessage("已啟動導航");
        } else if (window.Android && window.Android.startNavigation) {
          // 備用方法
          console.log("呼叫 Android.startNavigation:", lat, lon);
          window.Android.startNavigation(lat, lon);
          showMessage("已啟動導航");
        } else {
          console.error("Android 導航方法不可用");
          console.log("可用的 Android 方法:", Object.keys(window.Android || {}));
          showMessage("導航功能不可用");
        }
      } catch (err) {
        console.error("導航錯誤:", err);
        showMessage("導航失敗：" + err.message);
      }
    };

    // 巡勘打卡
    document.getElementById("btnCheckin").onclick = function() {
      console.log("🚩 巡勘打卡啟動");

      getUserLocation(
        function(userLat, userLng) {
          // 桃園座標已是 WGS84 (經緯度)，不需要轉換
          var siteLat = attrs.coordinates.y;  // 緯度
          var siteLng = attrs.coordinates.x;  // 經度

          console.log("使用者:", userLat, userLng);
          console.log("施工點:", siteLat, siteLng);

          var dist = calcDistanceMeter(
            userLat, userLng,
            siteLat, siteLng
          );

          console.log("距離:", dist, "m");

          if (dist <= 50) {
            // 距離在 50 公尺內，執行打卡
            var now = new Date();
            var timeStr = now.getFullYear() + "/" +
              String(now.getMonth() + 1).padStart(2, '0') + "/" +
              String(now.getDate()).padStart(2, '0') + " " +
              String(now.getHours()).padStart(2, '0') + ":" +
              String(now.getMinutes()).padStart(2, '0');

            var ref = window.db.ref("TY/RLIST/" + attrs.acNo + "/Doneflag");

            ref.set(timeStr)
              .then(function() {
                console.log("打卡成功:", timeStr);
                showMessage("巡勘打卡成功！");

                attrs.doneFlag = timeStr;
                updatePointColor(attrs);
              })
              .catch(function(err) {
                console.error("打卡失敗:", err);
                showMessage("打卡失敗，請稍後再試");
              });
          } else {
            showMessage("距離施工點 " + Math.round(dist) + " 公尺，超出 50 公尺");
          }
        },
        function(msg) {
          showMessage(msg);
        }
      );
    };

    // 發送簡訊
    document.getElementById("btnSms").onclick = function() {
      console.log("發送簡訊功能");
      console.log("使用 JSON 資料:", attrs);

      // ⭐ 直接使用 JSON 資料（不需要 Firebase）
      showSmsDialog(attrs);
    };

    // 關閉對話框
    document.getElementById("btnCloseDialog").onclick = function() {
      document.getElementById("firebaseDialogMask").remove();
    };
  }

  /**
   * 顯示股長代理設定對話框
   * 需要檢查登入者是否為某個 CENTOFF 的 MASTER
   */
  function showDeputySettingDialog(attrs) {
    console.log('========================================');
    console.log('👤 showDeputySettingDialog 被呼叫');
    console.log('========================================');

    // 1. 先從 Android 取得登入者名字
    if (!window.Android || !window.Android.getCurrentUserName) {
      alert('無法取得登入者資訊，請確認 Android 介面');
      return;
    }

    // 呼叫 Android 取得登入者名字
    var currentUserName = window.Android.getCurrentUserName();
    console.log('登入者名字:', currentUserName);

    if (!currentUserName || currentUserName.trim() === '') {
      alert('無法取得登入者資訊');
      return;
    }

    // 2. 檢查是否為任一 CENTOFF 的 MASTER
    console.log('檢查 TY/CENTOFF 權限...');

    var centoffRef = window.db.ref('TY/CENTOFF');
    centoffRef.once('value').then(function(snapshot) {
      if (!snapshot.exists()) {
        console.error('❌ TY/CENTOFF 不存在');
        alert('無法讀取中心局資料');
        return;
      }

      var centoffData = snapshot.val();
      var hasMasterRole = false;
      var matchingCentoffKeys = [];  // 所有符合的 CENTOFF Key
      var currentMaster = '';
      var currentMphone = '';

      // 檢查每個 CENTOFF，找出所有 MASTER 同名的
      Object.keys(centoffData).forEach(function(key) {
        var centoff = centoffData[key];
        if (centoff.MASTER === currentUserName) {
          hasMasterRole = true;
          matchingCentoffKeys.push(key);
          currentMaster = centoff.MASTER || '';
          currentMphone = centoff.MPHONE || '';
          console.log('✓ 找到權限: CENTOFF/' + key);
        }
      });

      if (!hasMasterRole) {
        console.log('❌ 無權限: ' + currentUserName + ' 不是任何 CENTOFF 的 MASTER');
        alert('您沒有權限使用此功能\n（僅限股長使用）');
        return;
      }

      console.log('✓ 有權限，顯示修改對話框');
      console.log('  符合的 CENTOFF 數量:', matchingCentoffKeys.length);
      console.log('  CENTOFF Keys:', matchingCentoffKeys.join(', '));
      console.log('  目前 MASTER:', currentMaster);
      console.log('  目前 MPHONE:', currentMphone);

      // 3. 顯示修改對話框
      showDeputyEditDialog(currentUserName, matchingCentoffKeys, currentMaster, currentMphone);

    }).catch(function(err) {
      console.error('❌ 讀取 CENTOFF 失敗:', err);
      alert('讀取資料失敗: ' + err.message);
    });
  }

  /**
   * 顯示股長代理設定編輯對話框
   */
  function showDeputyEditDialog(originalMasterName, centoffKeys, currentMaster, currentMphone) {
    console.log('顯示股長代理設定編輯對話框');

    // 移除舊的對話框
    var existingMask = document.getElementById('deputyDialogMask');
    if (existingMask) {
      existingMask.remove();
    }

    // 建立遮罩
    var mask = document.createElement('div');
    mask.id = 'deputyDialogMask';
    mask.style.position = 'fixed';
    mask.style.left = '0';
    mask.style.top = '0';
    mask.style.width = '100vw';
    mask.style.height = '100vh';
    mask.style.background = 'rgba(0,0,0,0.6)';
    mask.style.display = 'flex';
    mask.style.justifyContent = 'center';
    mask.style.alignItems = 'center';
    mask.style.zIndex = '99999';

    // 建立對話框
    var dialog = document.createElement('div');
    dialog.style.width = '90%';
    dialog.style.maxWidth = '400px';
    dialog.style.background = '#fff';
    dialog.style.borderRadius = '10px';
    dialog.style.boxShadow = '0 4px 10px rgba(0,0,0,0.3)';
    dialog.style.padding = '20px';
    dialog.style.fontFamily = 'Arial, sans-serif';

    dialog.innerHTML = `
      <h3 style="margin: 0 0 15px 0; color: #333; font-size: 18px; border-bottom: 2px solid #4CAF50; padding-bottom: 10px;">
        👤 股長代理設定
      </h3>

      <div style="margin-bottom: 10px; padding: 10px; background: #e3f2fd; border-radius: 6px;">
        <div style="font-size: 12px; color: #666; margin-bottom: 5px;">將更新以下中心局</div>
        <div style="font-size: 14px; color: #333; font-weight: bold;">${centoffKeys.join(', ')}</div>
        <div style="font-size: 12px; color: #999; margin-top: 5px;">共 ${centoffKeys.length} 個中心局</div>
      </div>

      <div style="margin-bottom: 10px; padding: 10px; background: #fff3cd; border-radius: 6px; border-left: 4px solid #ffc107;">
        <div style="font-size: 12px; color: #856404;">
          ⚠️ 此操作將同時更新：<br>
          • TY/CENTOFF 底下所有 MASTER 為「${originalMasterName}」的紀錄<br>
          • TY/RLIST 底下所有案件的 MASTER 和 MPHONE
        </div>
      </div>

      <div style="margin-bottom: 15px;">
        <label style="display: block; margin-bottom: 5px; color: #555; font-weight: bold;">代理股長姓名：</label>
        <input type="text"
               id="inputDeputyName"
               value="${currentMaster}"
               placeholder="請輸入代理股長姓名"
               style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box;">
      </div>

      <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 5px; color: #555; font-weight: bold;">代理股長電話：</label>
        <input type="tel"
               id="inputDeputyPhone"
               value="${currentMphone}"
               placeholder="請輸入代理股長電話"
               style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box;">
      </div>

      <button id="btnSaveDeputy"
              style="width: 100%; padding: 12px; margin-bottom: 10px; border: none; border-radius: 6px; background: #4CAF50; color: #fff; font-weight: bold; cursor: pointer; font-size: 14px;">
        💾 儲存設定（批次更新）
      </button>

      <button id="btnCancelDeputy"
              style="width: 100%; padding: 12px; border: none; border-radius: 6px; background: #757575; color: #fff; font-weight: bold; cursor: pointer; font-size: 14px;">
        取消
      </button>
    `;

    mask.appendChild(dialog);
    document.body.appendChild(mask);

    // 綁定儲存按鈕
    document.getElementById('btnSaveDeputy').onclick = function() {
      var newMaster = document.getElementById('inputDeputyName').value.trim();
      var newMphone = document.getElementById('inputDeputyPhone').value.trim();

      console.log('========================================');
      console.log('儲存股長代理設定（批次更新）');
      console.log('  原 MASTER 名字:', originalMasterName);
      console.log('  新 MASTER:', newMaster);
      console.log('  新 MPHONE:', newMphone);
      console.log('  要更新的 CENTOFF 數量:', centoffKeys.length);
      console.log('========================================');

      // 驗證輸入
      if (!newMaster) {
        alert('請輸入代理股長姓名');
        return;
      }

      if (!newMphone) {
        alert('請輸入代理股長電話');
        return;
      }

      // 驗證手機號碼格式
      var phonePattern = /^09\d{8}$/;
      var cleanedPhone = newMphone.replace(/[^0-9]/g, '');
      if (!phonePattern.test(cleanedPhone)) {
        alert('電話號碼格式錯誤\n請輸入 09 開頭的 10 碼手機號碼');
        return;
      }

      // 顯示載入中
      document.getElementById('btnSaveDeputy').disabled = true;
      document.getElementById('btnSaveDeputy').textContent = '⏳ 更新中...';

      // 批次更新
      updateDeputyBatch(originalMasterName, centoffKeys, newMaster, cleanedPhone, mask);
    };

    // 綁定取消按鈕
    document.getElementById('btnCancelDeputy').onclick = function() {
      mask.remove();
    };

    // 點擊遮罩關閉
    mask.onclick = function(e) {
      if (e.target === mask) {
        mask.remove();
      }
    };
  }

  /**
   * 批次更新股長代理設定
   * 同時更新 TY/CENTOFF 和 TY/RLIST
   */
  function updateDeputyBatch(originalMasterName, centoffKeys, newMaster, newMphone, mask) {
    console.log('========================================');
    console.log('🔄 開始批次更新');
    console.log('========================================');

    var updates = {};
    var centoffUpdateCount = 0;

    // 1. 準備更新所有符合的 CENTOFF
    centoffKeys.forEach(function(key) {
      updates['TY/CENTOFF/' + key + '/MASTER'] = newMaster;
      updates['TY/CENTOFF/' + key + '/MPHONE'] = newMphone;
      centoffUpdateCount++;
      console.log('✓ 準備更新 CENTOFF/' + key);
    });

    console.log('CENTOFF 更新數量:', centoffUpdateCount);

    // 2. 先更新 CENTOFF
    window.db.ref().update(updates).then(function() {
      console.log('✅ CENTOFF 批次更新完成');

      // 3. 再更新 RLIST（所有 MASTER 同名的案件）
      console.log('========================================');
      console.log('開始更新 TY/RLIST...');

      var rlistRef = window.db.ref('TY/RLIST');
      rlistRef.once('value').then(function(snapshot) {
        if (!snapshot.exists()) {
          console.log('⚠️ TY/RLIST 不存在或為空');
          finishUpdate(centoffUpdateCount, 0, newMaster, newMphone, mask);
          return;
        }

        var rlistData = snapshot.val();
        var rlistUpdates = {};
        var rlistUpdateCount = 0;

        // 找出所有 MASTER 同名的案件
        Object.keys(rlistData).forEach(function(acNo) {
          var caseData = rlistData[acNo];
          if (caseData.MASTER === originalMasterName) {
            rlistUpdates['TY/RLIST/' + acNo + '/MASTER'] = newMaster;
            rlistUpdates['TY/RLIST/' + acNo + '/MPHONE'] = newMphone;
            rlistUpdateCount++;
            console.log('✓ 準備更新 RLIST/' + acNo);
          }
        });

        console.log('RLIST 更新數量:', rlistUpdateCount);

        if (rlistUpdateCount === 0) {
          console.log('⚠️ 無需更新 RLIST（無符合案件）');
          finishUpdate(centoffUpdateCount, 0, newMaster, newMphone, mask);
          return;
        }

        // 執行 RLIST 批次更新
        window.db.ref().update(rlistUpdates).then(function() {
          console.log('✅ RLIST 批次更新完成');
          finishUpdate(centoffUpdateCount, rlistUpdateCount, newMaster, newMphone, mask);
        }).catch(function(err) {
          console.error('❌ RLIST 更新失敗:', err);
          alert('RLIST 更新失敗: ' + err.message);
          mask.remove();
        });

      }).catch(function(err) {
        console.error('❌ 讀取 RLIST 失敗:', err);
        alert('讀取 RLIST 失敗: ' + err.message);
        mask.remove();
      });

    }).catch(function(err) {
      console.error('❌ CENTOFF 更新失敗:', err);
      alert('CENTOFF 更新失敗: ' + err.message);
      mask.remove();
    });
  }

  /**
   * 完成更新，顯示結果
   */
  function finishUpdate(centoffCount, rlistCount, newMaster, newMphone, mask) {
    console.log('========================================');
    console.log('✅ 股長代理設定更新完成');
    console.log('  CENTOFF 更新數量:', centoffCount);
    console.log('  RLIST 更新數量:', rlistCount);
    console.log('  新 MASTER:', newMaster);
    console.log('  新 MPHONE:', newMphone);
    console.log('========================================');

    alert('股長代理設定更新完成\n\n' +
          '代理股長：' + newMaster + '\n' +
          '電話：' + newMphone + '\n\n' +
          '已更新：\n' +
          '• 中心局（CENTOFF）：' + centoffCount + ' 筆\n' +
          '• 施工案件（RLIST）：' + rlistCount + ' 筆');

    mask.remove();
  }

  /**
   * 清理和驗證電話號碼
   * @param {string} phone - 原始電話號碼
   * @return {string} - 清理後的手機號碼，如果不是手機號碼則返回空字串
   */
  function cleanPhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') {
      console.log('  cleanPhoneNumber: 輸入無效 -', phone);
      return '';
    }

    // 移除所有非數字字元（-、空格、括號等）
    var cleaned = phone.replace(/[^0-9]/g, '');
    console.log('  cleanPhoneNumber: "' + phone + '" → "' + cleaned + '"');

    // 檢查是否為手機號碼（09 開頭，共 10 碼）
    if (cleaned.match(/^09\d{8}$/)) {
      console.log('    ✓ 有效手機號碼');
      return cleaned;
    }

    // 不是有效的手機號碼
    console.log('    ✗ 不是有效手機號碼（需要 09 開頭 10 碼）');
    return '';
  }

  /**
   * 顯示簡訊發送對話框
   */
  function showSmsDialog(attrs) {
    console.log('========================================');
    console.log('showSmsDialog 被呼叫');
    console.log('attrs:', attrs);
    console.log('🔍 檢查收件人資料:');
    console.log('  中華電信 - master:', attrs.master, 'mphone:', attrs.mphone);
    console.log('  中華電信 - owner:', attrs.owner, 'ophone:', attrs.ophone);
    console.log('  中華電信 - owner2:', attrs.owner2, 'ophone2:', attrs.ophone2);
    console.log('  廠商 - tcMa3:', attrs.tcMa3, 'tcTl3:', attrs.tcTl3);
    console.log('  委託 - tcMa:', attrs.tcMa, 'tcTl:', attrs.tcTl);
    console.log('========================================');

    // 移除舊的對話框（如果存在）
    var existingMask = document.getElementById("smsDialogMask");
    if (existingMask) {
      existingMask.remove();
    }

    // 建立遮罩
    var mask = document.createElement("div");
    mask.id = "smsDialogMask";
    mask.style.position = "fixed";
    mask.style.left = "0";
    mask.style.top = "0";
    mask.style.width = "100vw";
    mask.style.height = "100vh";
    mask.style.background = "rgba(0,0,0,0.5)";
    mask.style.display = "flex";
    mask.style.justifyContent = "center";
    mask.style.alignItems = "center";
    mask.style.zIndex = "99999";

    // 建立對話框
    var dialog = document.createElement("div");
    dialog.id = "smsDialog";
    dialog.style.width = "360px";
    dialog.style.maxHeight = "80vh";
    dialog.style.overflowY = "auto";
    dialog.style.background = "#fff";
    dialog.style.borderRadius = "10px";
    dialog.style.boxShadow = "0 4px 10px rgba(0,0,0,0.3)";
    dialog.style.padding = "16px";
    dialog.style.fontFamily = "Arial, sans-serif";

    // 判斷發送狀態
    var smsSendTime = attrs.smsSend || attrs["SMS-send"] || "";
    var isSent = false;
    var sendStatusText = "未發送";

    // 檢查是否為有效的時間格式
    if (smsSendTime && smsSendTime.trim() !== "" && smsSendTime !== "undefined") {
      // 簡單檢查是否包含日期時間相關字符
      if (smsSendTime.match(/\d{4}/) || smsSendTime.match(/\d{2}:\d{2}/)) {
        isSent = true;
        sendStatusText = "已發送：" + smsSendTime;
      }
    }

    // 準備收件人資料
    var recipients = [];

    // ⭐ 施工廠商 - 現場人員（tcMa3, tcTl3）
    var vendorPhone = cleanPhoneNumber(attrs.tcTl3);
    if (vendorPhone) {  // ⭐ 只檢查電話，不檢查姓名
      recipients.push({
        category: "現場人員",
        name: attrs.tcMa3 || "（未提供姓名）",  // ⭐ 姓名為空時顯示提示
        phone: vendorPhone,
        isCHT: false
      });
      console.log('✓ 加入現場人員:', attrs.tcMa3 || '（未提供姓名）', vendorPhone);
    } else {
      console.log('✗ 跳過現場人員: name=', attrs.tcMa3, ', phone=', attrs.tcTl3, ', cleaned=', vendorPhone);
    }

    // ⭐ 施工廠商 - 廠商窗口（tcMa, tcTl）
    var contactPhone = cleanPhoneNumber(attrs.tcTl);
    if (contactPhone) {  // ⭐ 只檢查電話，不檢查姓名
      recipients.push({
        category: "廠商窗口",
        name: attrs.tcMa || "（未提供姓名）",  // ⭐ 姓名為空時顯示提示
        phone: contactPhone,
        isCHT: false
      });
      console.log('✓ 加入廠商窗口:', attrs.tcMa || '（未提供姓名）', contactPhone);
    } else {
      console.log('✗ 跳過廠商窗口: name=', attrs.tcMa, ', phone=', attrs.tcTl, ', cleaned=', contactPhone);
    }

    // ⭐ 中華電信人員（如果 Firebase 有提供的話）
    // 股長
    var masterPhone = cleanPhoneNumber(attrs.mphone);
    if (masterPhone) {  // ⭐ 只檢查電話
      recipients.push({
        category: "中華電信",
        name: (attrs.master || "（未提供姓名）") + " 股長",
        phone: masterPhone,
        isCHT: true
      });
      console.log('✓ 加入股長:', attrs.master || '（未提供姓名）', masterPhone);
    }

    // 負責人
    var ownerPhone = cleanPhoneNumber(attrs.ophone);
    if (ownerPhone) {  // ⭐ 只檢查電話
      recipients.push({
        category: "負責人",
        name: attrs.owner || "（未提供姓名）",
        phone: ownerPhone,
        isCHT: true
      });
      console.log('✓ 加入負責人:', attrs.owner || '（未提供姓名）', ownerPhone);
    }

    // 負責人2
    var owner2Phone = cleanPhoneNumber(attrs.ophone2);
    if (owner2Phone) {  // ⭐ 只檢查電話
      recipients.push({
        category: "負責人2",
        name: attrs.owner2 || "（未提供姓名）",
        phone: owner2Phone,
        isCHT: true
      });
      console.log('✓ 加入負責人2:', attrs.owner2 || '（未提供姓名）', owner2Phone);
    }

    // ⭐ Debug: 檢查收件人列表
    console.log('========================================');
    console.log('📋 收件人列表（共', recipients.length, '位）:');
    if (recipients.length === 0) {
      console.error('❌ 收件人列表是空的！');
      console.error('請檢查以下欄位是否有值:');
      console.error('  master:', attrs.master, 'mphone:', attrs.mphone);
      console.error('  owner:', attrs.owner, 'ophone:', attrs.ophone);
      console.error('  owner2:', attrs.owner2, 'ophone2:', attrs.ophone2);
      console.error('  tcMa3:', attrs.tcMa3, 'tcTl3:', attrs.tcTl3);
      console.error('  tcMa:', attrs.tcMa, 'tcTl:', attrs.tcTl);
    } else {
      recipients.forEach(function(r, i) {
        console.log('  ' + (i+1) + '.', r.category, '-', r.name, '-', r.phone, '(CHT:', r.isCHT + ')');
      });
    }
    console.log('========================================');

    // 建立HTML內容
    var html = `
      <h3 style="margin-top:0; color:#333;">發送簡訊通知</h3>

      <div style="padding: 8px; background: ${isSent ? '#d4edda' : '#fff3cd'}; border-radius: 6px; margin-bottom: 12px; border: 1px solid ${isSent ? '#c3e6cb' : '#ffeaa7'};">
        <strong style="color: ${isSent ? '#155724' : '#856404'};">發送狀態：</strong>
        <span style="color: ${isSent ? '#155724' : '#856404'};">${sendStatusText}</span>
      </div>

      <div style="margin-bottom: 12px;">
        <button id="btnSelectAll" style="padding: 6px 12px; margin-right: 6px; border: 1px solid #0d6efd; border-radius: 4px; background: #0d6efd; color: #fff; cursor: pointer;">全選</button>
        <button id="btnDeselectAll" style="padding: 6px 12px; border: 1px solid #6c757d; border-radius: 4px; background: #6c757d; color: #fff; cursor: pointer;">取消全選</button>
      </div>

      <div id="recipientList" style="margin-bottom: 16px;">
    `;

    // 加入收件人勾選框
    recipients.forEach(function(recipient, index) {
      html += `
        <div style="padding: 8px; border-bottom: 1px solid #eee; display: flex; align-items: center; justify-content: space-between;">
          <label style="display: flex; align-items: center; cursor: pointer; flex: 1;">
            <input type="checkbox"
                   class="sms-recipient-checkbox"
                   data-index="${index}"
                   data-category="${recipient.category}"
                   data-name="${recipient.name}"
                   data-phone="${recipient.phone}"
                   data-ischt="${recipient.isCHT}"
                   style="margin-right: 8px; width: 18px; height: 18px; cursor: pointer;">
            <div>
              <div style="font-weight: bold; color: #333;">${recipient.category}</div>
              <div style="font-size: 13px; color: #666;">${recipient.name} - ${recipient.phone}</div>
            </div>
          </label>
          <button class="btn-call-phone"
                  data-phone="${recipient.phone}"
                  data-name="${recipient.name}"
                  style="padding: 6px 12px; margin-left: 8px; border: 1px solid #28a745; border-radius: 4px; background: #28a745; color: #fff; cursor: pointer; font-size: 12px; white-space: nowrap;">
            📞 撥號
          </button>
        </div>
      `;
    });

    html += `
      </div>

      <div id="smsContentArea" style="margin-bottom: 16px;">
        <!-- 簡訊內容輸入框會動態插入這裡 -->
      </div>

      <button id="btnConfirmSms" style="width: 100%; padding: 10px; margin-bottom: 8px; border: none; border-radius: 6px; background: #28a745; color: #fff; font-weight: bold; cursor: pointer;">
        確認發送簡訊
      </button>

      <button id="btnCloseSmsDialog" style="width: 100%; padding: 10px; border: none; border-radius: 6px; background: #6c757d; color: #fff; cursor: pointer;">
        取消
      </button>
    `;

    dialog.innerHTML = html;
    mask.appendChild(dialog);
    document.body.appendChild(mask);

    // 儲存收件人資料供後續使用
    dialog.recipientsData = recipients;

    console.log('========================================');
    console.log('簡訊對話框 - 收件人列表:');
    recipients.forEach(function(r, i) {
      console.log(i + ':', r.category, '-', r.name, '-', r.phone, '(CHT:', r.isCHT + ')');
    });
    console.log('========================================');

    // 更新簡訊內容區域（定義在這裡）
    function updateSmsContentArea() {
      var checkboxes = document.querySelectorAll(".sms-recipient-checkbox");
      var hasCHT = false;
      var hasNonCHT = false;

      checkboxes.forEach(function(cb) {
        if (cb.checked) {
          if (cb.dataset.ischt === "true") {
            hasCHT = true;
          } else {
            hasNonCHT = true;
          }
        }
      });

      console.log('更新簡訊內容區域: hasCHT =', hasCHT, ', hasNonCHT =', hasNonCHT);

      var smsContentArea = document.getElementById("smsContentArea");
      var contentHtml = "";

      // 產生 Google Maps 導航連結（桃園的座標已經是 WGS84）
      var vDirectionUrl = "";
      if (attrs.coordinates && attrs.coordinates.x && attrs.coordinates.y) {
        // 桃園的 coordinates 是 WGS84 (經度, 緯度)
        vDirectionUrl = "https://www.google.com/maps?q=" + attrs.coordinates.y + "," + attrs.coordinates.x;
        console.log('Google Maps 連結:', vDirectionUrl);
      } else {
        console.warn('⚠️ 座標資料不完整，無法產生 Google Maps 連結');
      }

      // 中華電信簡訊內容（發給中華電信人員，通知去巡查）
      if (hasCHT) {
        var chtMessage = "路證編號:" + attrs.acNo + "於今日施工，請派員前往巡查，施工地點:" + vDirectionUrl;
        contentHtml += `
          <div style="margin-bottom: 12px; padding: 10px; background: #e7f3ff; border-radius: 6px; border: 1px solid #b3d9ff;">
            <label style="font-weight: bold; color: #0056b3; display: block; margin-bottom: 6px;">發給中華電信人員：</label>
            <textarea id="chtSmsContent" style="width: 100%; height: 80px; padding: 6px; border-radius: 4px; border: 1px solid #b3d9ff; font-size: 13px; font-family: Arial, sans-serif;">${chtMessage}</textarea>
          </div>
        `;
      }

      // 非中華電信簡訊內容（發給廠商，提醒注意管線）
      if (hasNonCHT) {
        var ownerName = attrs.owner || "";
        var ownerPhone = attrs.ophone || "";
        var nonChtMessage = "您好，貴公司路證編號:" + attrs.acNo + "施工範圍附近底下有中華電信重要管線，請小心施工開挖，如需協助請通知本公司轄區負責窗口 " + ownerName + " " + ownerPhone;
        contentHtml += `
          <div style="margin-bottom: 12px; padding: 10px; background: #fff4e6; border-radius: 6px; border: 1px solid #ffd699;">
            <label style="font-weight: bold; color: #cc6600; display: block; margin-bottom: 6px;">發給施工廠商：</label>
            <textarea id="nonChtSmsContent" style="width: 100%; height: 80px; padding: 6px; border-radius: 4px; border: 1px solid #ffd699; font-size: 13px; font-family: Arial, sans-serif;">${nonChtMessage}</textarea>
          </div>
        `;
      }

      smsContentArea.innerHTML = contentHtml;
    }

    // 監聽勾選變化
    var checkboxes = document.querySelectorAll(".sms-recipient-checkbox");
    checkboxes.forEach(function(cb) {
      cb.addEventListener("change", updateSmsContentArea);
    });

    // ⭐ 綁定撥號按鈕事件
    var callButtons = document.querySelectorAll(".btn-call-phone");
    callButtons.forEach(function(btn) {
      btn.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();  // 防止觸發 label 的點擊

        var phone = this.getAttribute('data-phone');
        var name = this.getAttribute('data-name');

        console.log('========================================');
        console.log('📞 撥號按鈕被點擊');
        console.log('  姓名:', name);
        console.log('  電話:', phone);
        console.log('========================================');

        // 使用 Android 介面撥號
        if (window.Android && window.Android.makePhoneCall) {
          console.log('✓ 呼叫 Android.makePhoneCall');
          window.Android.makePhoneCall(phone);
        } else if (window.Android && window.Android.dialPhone) {
          // 備用方法名稱
          console.log('✓ 呼叫 Android.dialPhone');
          window.Android.dialPhone(phone);
        } else {
          // 網頁版 fallback（在手機瀏覽器會開啟撥號）
          console.log('✓ 使用 tel: 連結');
          window.location.href = 'tel:' + phone;
        }
      };
    });

    // ⭐ 預設勾選所有收件人（這樣簡訊內容會直接顯示）
    setTimeout(function() {
      console.log('預設勾選所有收件人');
      var checkboxes = document.querySelectorAll(".sms-recipient-checkbox");
      checkboxes.forEach(function(cb) {
        cb.checked = true;  // 預設全選
      });
      updateSmsContentArea();  // 更新顯示
    }, 100);

    // 全選按鈕
    document.getElementById("btnSelectAll").onclick = function() {
      var checkboxes = document.querySelectorAll(".sms-recipient-checkbox");
      checkboxes.forEach(function(cb) {
        cb.checked = true;
      });
      updateSmsContentArea();
    };

    // 取消全選按鈕
    document.getElementById("btnDeselectAll").onclick = function() {
      var checkboxes = document.querySelectorAll(".sms-recipient-checkbox");
      checkboxes.forEach(function(cb) {
        cb.checked = false;
      });
      updateSmsContentArea();
    };

    // 確認發送按鈕
    document.getElementById("btnConfirmSms").onclick = function() {
      var checkboxes = document.querySelectorAll(".sms-recipient-checkbox:checked");

      if (checkboxes.length === 0) {
        showMessage("請至少選擇一位收件人");
        return;
      }

      // 收集選中的收件人
      var selectedRecipients = {
        cht: [],      // 中華電信
        nonCht: []    // 非中華電信
      };

      checkboxes.forEach(function(cb) {
        var recipientData = {
          category: cb.dataset.category,
          name: cb.dataset.name,
          phone: cb.dataset.phone,
          isCHT: cb.dataset.ischt === "true"
        };

        if (recipientData.isCHT) {
          selectedRecipients.cht.push(recipientData);
        } else {
          selectedRecipients.nonCht.push(recipientData);
        }
      });

      // 取得簡訊內容
      var chtSmsContent = "";
      var nonChtSmsContent = "";

      var chtTextarea = document.getElementById("chtSmsContent");
      var nonChtTextarea = document.getElementById("nonChtSmsContent");

      if (chtTextarea) {
        chtSmsContent = chtTextarea.value.trim();
      }

      if (nonChtTextarea) {
        nonChtSmsContent = nonChtTextarea.value.trim();
      }

      // 驗證簡訊內容
      if (selectedRecipients.cht.length > 0 && !chtSmsContent) {
        showMessage("請填寫中華電信簡訊內容");
        return;
      }

      if (selectedRecipients.nonCht.length > 0 && !nonChtSmsContent) {
        showMessage("請填寫非中華電信簡訊內容");
        return;
      }

      console.log("準備發送簡訊:", selectedRecipients);
      console.log("中華電信收件人:", selectedRecipients.cht.length, "位");
      console.log("非中華電信收件人:", selectedRecipients.nonCht.length, "位");
      console.log("中華電信簡訊內容:", chtSmsContent);
      console.log("非中華電信簡訊內容:", nonChtSmsContent);

      // 關閉對話框
      document.getElementById("smsDialogMask").remove();

      // 開始發送簡訊
      sendSmsMessages(attrs.acNo, selectedRecipients, chtSmsContent, nonChtSmsContent);
    };

    // 關閉按鈕
    document.getElementById("btnCloseSmsDialog").onclick = function() {
      document.getElementById("smsDialogMask").remove();
    };
  }

  /**
   * 發送簡訊功能
   */
  function sendSmsMessages(acNo, recipients, chtContent, nonChtContent) {
    var totalCount = recipients.cht.length + recipients.nonCht.length;
    var successCount = 0;
    var failCount = 0;
    var completed = 0;

    console.log("開始發送簡訊，總共:", totalCount, "位收件人");

    // 發送中華電信簡訊
    recipients.cht.forEach(function(recipient) {
      sendSingleSms(recipient.phone, chtContent, function(success, response) {
        completed++;
        if (success) {
          successCount++;
          console.log("發送成功:", recipient.name, recipient.phone);
        } else {
          failCount++;
          console.error("發送失敗:", recipient.name, recipient.phone, response);
        }

        // 檢查是否全部完成
        if (completed === totalCount) {
          onAllSmsCompleted(acNo, successCount, failCount);
        }
      });
    });

    // 發送非中華電信簡訊
    recipients.nonCht.forEach(function(recipient) {
      sendSingleSms(recipient.phone, nonChtContent, function(success, response) {
        completed++;
        if (success) {
          successCount++;
          console.log("發送成功:", recipient.name, recipient.phone);
        } else {
          failCount++;
          console.error("發送失敗:", recipient.name, recipient.phone, response);
        }

        // 檢查是否全部完成
        if (completed === totalCount) {
          onAllSmsCompleted(acNo, successCount, failCount);
        }
      });
    });
  }

  /**
   * 發送單一簡訊
   */
  function sendSingleSms(phoneNumber, message, callback) {
    if (window.Android && window.Android.sendSms) {
      // 呼叫 Android 的 sendSms 方法
      try {
        var response = window.Android.sendSms(phoneNumber, message);
        console.log("簡訊回應:", response);

        // 檢查回應是否以0開頭 (表示成功)
        var isSuccess = response && response.toString().startsWith("0");
        callback(isSuccess, response);
      } catch (e) {
        console.error("發送簡訊異常:", e);
        callback(false, "Error: " + e.message);
      }
    } else {
      console.error("Android.sendSms 方法不存在");
      callback(false, "Android.sendSms not found");
    }
  }

  /**
   * 所有簡訊發送完成後的處理
   */
  function onAllSmsCompleted(acNo, successCount, failCount) {
    console.log("簡訊發送完成 - 成功:", successCount, "失敗:", failCount);

    // 如果有成功發送的簡訊，更新 Firebase
    if (successCount > 0) {
      var now = new Date();
      var sendTime = now.getFullYear() + "/" +
                     String(now.getMonth() + 1).padStart(2, '0') + "/" +
                     String(now.getDate()).padStart(2, '0') + " " +
                     String(now.getHours()).padStart(2, '0') + ":" +
                     String(now.getMinutes()).padStart(2, '0') + ":" +
                     String(now.getSeconds()).padStart(2, '0');

      var ref = window.db.ref("TY/RLIST/" + acNo + "/SMS-send");

      ref.set(sendTime)
        .then(function() {
          console.log("Firebase SMS-send 更新成功:", sendTime);

          var resultMsg = "簡訊發送完成\n";
          resultMsg += "成功: " + successCount + " 位\n";
          if (failCount > 0) {
            resultMsg += "失敗: " + failCount + " 位\n";
          }
          resultMsg += "發送時間已記錄: " + sendTime;

          showMessage(resultMsg);
        })
        .catch(function(err) {
          console.error("Firebase 更新失敗:", err);
          showMessage("簡訊發送完成，但記錄時間失敗\n成功: " + successCount + " 位\n失敗: " + failCount + " 位");
        });
    } else {
      // 全部失敗
      showMessage("簡訊發送失敗\n所有簡訊均未成功發送");
    }
  }

  window.TaoyuanConstructionModule = {
    init: init,
    loadConstructionData: loadConstructionData,
    receiveToken: receiveToken,
    receiveConstructionData: receiveConstructionData,
    selectDistrict: selectDistrict,
    setPipeLayerUrl: setPipeLayerUrl,
    setCableZoneConfig: setCableZoneConfig  // ⭐ 海纜配管區設定
  };

  console.log('TaoyuanConstructionModule 已掛載:', !!window.TaoyuanConstructionModule);
})();