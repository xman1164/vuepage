(function() {
  console.log('taipei-construction.js 開始執行');

  var API_URL = 'https://tpnco.blob.core.windows.net/blobfs/Appwork.json';
  var onShowMessage = null;
  var constructions = [];
  var view, map, Graphic, Polyline, Polygon, TextSymbol, geometryEngine, FeatureLayer, GraphicsLayer, graphicsLayer, layerList, pipeLayerUrl;
  var constructionGeomLayer = null;
  function init(callbacks, arcgisModules) {
    onShowMessage = callbacks.onShowMessage || null;
    view = arcgisModules.view;
    map = arcgisModules.map;
    Graphic = arcgisModules.Graphic;
    Polyline = arcgisModules.Polyline;
    Polygon = arcgisModules.Polygon;
    TextSymbol = arcgisModules.TextSymbol;
    geometryEngine = arcgisModules.geometryEngine;
    FeatureLayer = arcgisModules.FeatureLayer;
    GraphicsLayer = arcgisModules.GraphicsLayer;
    layerList = arcgisModules.layerList;
    projection = arcgisModules.projection;   // ⭐ 新增 (ArcGIS Projection 用來做 3826 → WGS84)

    // 建立專用的施工位置圖層
    if (!graphicsLayer) {
      graphicsLayer = new GraphicsLayer({ title: "台北市施工位置" });
      map.add(graphicsLayer);
      console.log('建立施工位置圖層');
    }
      // ⭐ 建立施工範圍圖層（Polygon / Line）
      if (!constructionGeomLayer) {
        constructionGeomLayer = new GraphicsLayer({ title: "施工範圍" });
        map.add(constructionGeomLayer);
        console.log('建立施工範圍圖層');
      }

    console.log('台北市今日施工位置模組已初始化');
  }

  // 顯示訊息的輔助函數
  function showMessage(msg) {
    if (onShowMessage) {
      onShowMessage(msg);
    } else {
      console.log('訊息:', msg);
    }
  }

  function setPipeLayerUrl(url) {
    pipeLayerUrl = url;
    console.log('設定幹線管道 URL:', pipeLayerUrl);
  }

  function loadConstructionData() {
    if (onShowMessage) onShowMessage('載入施工資料中...');
    if (window.Android && window.Android.downloadJson) {
      window.Android.downloadJson(API_URL, 'taipei');
    }
  }

  function processConstructionData(data) {
    console.log('收到施工資料:', data.features.length, '筆');
    constructions = data.features.map(function(f) {
      var c = f.geometry.coordinates;
      var p = f.properties;
      return {
        coordinates: {x: c[0], y: c[1]},
        acNo: p.Ac_no || '',
        appName: p.App_Name || '',
        cName: p.C_Name || '',
        addr: p.Addr || '',
        cbDa: p.Cb_Da || '',
        ceDa: p.Ce_Da || '',
        coTi: p.Co_Ti || '',
        tcNa: p.Tc_Na || '',
        tcMa: p.Tc_Ma || '',
        tcTl: p.Tc_Tl || '',
        tcMa3: p.Tc_Ma3 || '',
        tcTl3: p.Tc_Tl3 || '',
        nPurp: p.NPurp || '',
        wItem: p.WItem || '',
        positions: p.Positions,
        positionsType: p.Positions_type,
        pipeCount: 0
      };
    });
    console.log('解析完成');
    showDistrictMenu();
  }

  function showDistrictMenu() {
    var districts = {};
    constructions.forEach(function(c) {
      if (c.cName) districts[c.cName] = true;
    });
    var list = Object.keys(districts).sort();
    list.unshift('全部行政區');  // 放最前面
    console.log('行政區清單:', list);

    // 傳給 map.html 顯示 Vue 清單
    if (window.showConstructionDistrictList) {
      window.showConstructionDistrictList(list, 'taipei');
    }
  }

  function selectDistrict(district) {
    console.log('選擇行政區:', district);
    if (onShowMessage) onShowMessage('處理中...');

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

          // ⭐⭐⭐ 檢查是否滿足三個條件之一，才進行 queryPipe ⭐⭐⭐
          var shouldQuery = false;

          // 條件 1: JSON 內包含特定關鍵字（明挖、路改、路基改善、搶修、挖掘、潛盾）
          var keywords = ['明挖', '路改', '路基改善', '搶修', '挖掘', '潛盾'];
          var jsonString = JSON.stringify(c);
          for (var i = 0; i < keywords.length; i++) {
            if (jsonString.indexOf(keywords[i]) !== -1) {
              shouldQuery = true;
              console.log('✓ 條件1滿足 - 包含關鍵字:', keywords[i], '| acNo:', c.acNo);
              break;
            }
          }

          // 條件 2: wItem包含"側溝工程" AND appName包含"水利處"
          if (!shouldQuery) {
            var hasGutter = c.wItem && c.wItem.indexOf('側溝工程') !== -1;
            var hasWater = c.appName && c.appName.indexOf('水利處') !== -1;
            if (hasGutter && hasWater) {
              shouldQuery = true;
              console.log('✓ 條件2滿足 - 側溝工程 + 水利處 | acNo:', c.acNo);
            }
          }

          // 條件 3: (wItem 或 nPurp)包含"市政建設" AND appName包含"捷運"
          if (!shouldQuery) {
            var hasMarketInWItem = c.wItem && c.wItem.indexOf('市政建設') !== -1;
            var hasMarketInNPurp = c.nPurp && c.nPurp.indexOf('市政建設') !== -1;
            var hasMarket = hasMarketInWItem || hasMarketInNPurp;
            var hasMRT = c.appName && c.appName.indexOf('捷運') !== -1;
            if (hasMarket && hasMRT) {
              shouldQuery = true;
              console.log('✓ 條件3滿足 - 市政建設 + 捷運 | acNo:', c.acNo);
            }
          }

          // 如果不滿足任何條件，跳過此筆
          if (!shouldQuery) {
            console.log('✗ 不符合條件，跳過 | acNo:', c.acNo, '| wItem:', c.wItem, '| appName:', c.appName);
            if (--pending === 0) display(filtered);
            return;
          }

          console.log('✓ 符合條件，開始查詢幹管 | acNo:', c.acNo);

          queryPipe(geom, function(count) {

            c.pipeCount = count;

            // ⭐⭐⭐ 只有 count > 0 時，才存入 geom、撈 Firebase ⭐⭐⭐
            if (count > 0) {

              // ⬇️ 只有這裡才會存 geometry
              c.geom = geom;
              c.geomType = c.positionsType;

              // ⭐ Firebase 撈資料
              var ref = window.db.ref("TP/RLIST/" + c.acNo);
              console.log('REDB已呼叫', ref);

              ref.once("value")
                .then(function(snapshot) {

                  if (snapshot.exists()) {

                    var data = snapshot.val();

                    // ⭐ 只有 count>0 才會寫入 Firebase 欄位
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

                    // 1. 取得 TPCAREA 圖層 URL
                    var tpcAreaUrl = "";
                    if (window.Android && window.Android.getLayerUrl) {
                      tpcAreaUrl = window.Android.getLayerUrl('TPCAREA');
                      console.log('取得 TPCAREA 圖層 URL:', tpcAreaUrl);
                    } else {
                      console.error('無法取得 TPCAREA 圖層 URL');
                    }

                    if (tpcAreaUrl && geom) {
                      // 2. 與 TPCAREA 圖層進行交集查詢
                      console.log('開始與 TPCAREA 圖層交集查詢...');

                      var tpcAreaLayer = new FeatureLayer({ url: tpcAreaUrl });

                      tpcAreaLayer.load().then(function() {
                        console.log('TPCAREA FeatureLayer 載入成功');

                        var query = tpcAreaLayer.createQuery();
                        query.geometry = geom;
                        query.spatialRelationship = 'intersects';
                        query.returnGeometry = false;
                        query.outFields = ['CENTOFF'];

                        tpcAreaLayer.queryFeatures(query).then(function(result) {
                          console.log('TPCAREA 交集查詢完成，找到:', result.features.length, '筆');

                          if (result.features.length > 0) {
                            var centoff = result.features[0].attributes.CENTOFF;
                            console.log('取得 CENTOFF:', centoff);

                            // 3. 從 Firebase TP/CENTOFF 取得中心局資料
                            var centoffRef = window.db.ref("TP/CENTOFF/" + centoff);
                            console.log('查詢 Firebase TP/CENTOFF/' + centoff);

                            centoffRef.once("value").then(function(centoffSnapshot) {
                              if (centoffSnapshot.exists()) {
                                var centoffData = centoffSnapshot.val();
                                console.log('取得 CENTOFF 資料:', centoffData);

                                // 4. 建立新的 RLIST 資料
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

                                // 5. 寫入 Firebase
                                var newRlistRef = window.db.ref("TP/RLIST/" + c.acNo);
                                newRlistRef.set(newRlistData)
                                  .then(function() {
                                    console.log('✅ RLIST 新資料寫入成功, Ac_no:', c.acNo);

                                    // 更新本地資料
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
                                console.log('⚠️ Firebase TP/CENTOFF/' + centoff + ' 無資料');
                                if (--pending === 0) display(filtered);
                              }
                            }).catch(function(err) {
                              console.error('❌ 查詢 CENTOFF 資料失敗:', err);
                              if (--pending === 0) display(filtered);
                            });

                          } else {
                            console.log('⚠️ 施工範圍與 TPCAREA 無交集');
                            if (--pending === 0) display(filtered);
                          }
                        }).catch(function(err) {
                          console.error('❌ TPCAREA 交集查詢失敗:', err);
                          if (--pending === 0) display(filtered);
                        });

                      }).catch(function(err) {
                        console.error('❌ TPCAREA FeatureLayer 載入失敗:', err);
                        if (--pending === 0) display(filtered);
                      });

                    } else {
                      console.log('⚠️ 無 TPCAREA URL 或無 geometry，跳過建立新資料');
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
              // ⭐ count == 0 不做任何 geom / firebase 動作
              // 直接顯示
              if (--pending === 0) display(filtered);
            }

          });

        } else {
          if (--pending === 0) display(filtered);
        }

      } else {
        if (--pending === 0) display(filtered);
      }

    });
  }

  function createGeometry(construction) {
    try {
      if (construction.positionsType === 'MultiLineString') {
        var PolylineClass = Polyline || window.Polyline || window.PolylineClass;
        if (!PolylineClass) {
          console.error('Polyline 類別未載入');
          return null;
        }
        return new PolylineClass({
          paths: construction.positions,
          spatialReference: {wkid: 3826}
        });
      } else if (construction.positionsType === 'MultiPolygon') {
        var PolygonClass = Polygon || window.Polygon || window.PolygonClass;
        if (!PolygonClass) {
          console.error('Polygon 類別未載入');
          return null;
        }
        var rings = [];
        construction.positions.forEach(function(polygon) {
          polygon.forEach(function(ring) {
            rings.push(ring);
          });
        });
        return new PolygonClass({
          rings: rings,
          spatialReference: {wkid: 3826}
        });
      }
    } catch (e) {
      console.error('建立 geometry 失敗:', e);
    }
    return null;
  }

  function queryPipe(geom, callback) {
    try {
      if (!pipeLayerUrl) {
        console.error('幹線管道 URL 未設定，請先點選施工位置功能');
        callback(0);
        return;
      }

      var buffered = geometryEngine.buffer(geom, 0.5, 'meters');

      console.log('使用幹線管道 URL:', pipeLayerUrl);

      var featureLayer = new FeatureLayer({url: pipeLayerUrl});

      featureLayer.load().then(function() {
        console.log('FeatureLayer 載入成功');

        var query = featureLayer.createQuery();
        query.geometry = buffered;
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

  function display(list) {
    console.log('開始顯示施工點');

    if (!graphicsLayer || !view) return;

    graphicsLayer.removeAll();

    var points3826 = [];
    var displayed = 0;

    list.forEach(function (c) {

      if (c.pipeCount > 0) {

        // 施工點 (3826)
        var point3826 = {
          type: "point",
          x: c.coordinates.x,
          y: c.coordinates.y,
          spatialReference: { wkid: 3826 }
        };

        points3826.push(point3826);

        // ⭐ Firebase 狀態判斷
        var hasDone = c.doneFlag && c.doneFlag.trim() !== "";
        var hasNote = c.note && c.note.trim() !== "";
        var isFinished = hasDone || hasNote;

        // ⭐ marker 顏色
        var markerSymbol = {
          type: "simple-marker",
          color: isFinished
            ? [0, 102, 204, 0.85]   // 🔵 藍色
            : [220, 53, 69, 0.85],  // 🔴 紅色
          size: 18,
          outline: {
            color: [255, 255, 255],
            width: 2
          }
        };

        var textSymbol = {
          type: "text",
          text: String(c.pipeCount),
          color: "white",
          font: {
            size: 12,
            weight: "bold"
          },
          yoffset: 0
        };

        graphicsLayer.add(new Graphic({
          geometry: point3826,
          symbol: markerSymbol,
          attributes: c
        }));

        graphicsLayer.add(new Graphic({
          geometry: point3826,
          symbol: textSymbol
        }));

        displayed++;
      }
    });

    console.log('顯示完成:', displayed, '個點');

    if (onShowMessage) {
      onShowMessage('已顯示 ' + displayed + ' 個施工點');
    }

    // ===============================
    // ⭐ Zoom to extent（最終穩定版）
    // ===============================
    if (points3826.length === 0) return;

    var xmin = points3826[0].x;
    var xmax = points3826[0].x;
    var ymin = points3826[0].y;
    var ymax = points3826[0].y;

    points3826.forEach(function (pt) {
      xmin = Math.min(xmin, pt.x);
      xmax = Math.max(xmax, pt.x);
      ymin = Math.min(ymin, pt.y);
      ymax = Math.max(ymax, pt.y);
    });

    var dx = Math.max((xmax - xmin) * 0.2, 100);
    var dy = Math.max((ymax - ymin) * 0.2, 100);

    var extent3826 = {
      type: "extent",  // ⭐ 必須
      xmin: xmin - dx,
      ymin: ymin - dy,
      xmax: xmax + dx,
      ymax: ymax + dy,
      spatialReference: { wkid: 3826 }
    };

    projection.load().then(function () {

      var projectedExtent = projection.project(
        extent3826,
        view.spatialReference
      );

      if (!projectedExtent) {
        console.error("Extent 投影失敗", extent3826);
        return;
      }

      view.goTo(projectedExtent, { duration: 800 })
        .then(() => console.log("Zoom 成功"))
        .catch(err => console.error("Zoom 失敗", err));

    });
    setupClickHandler();
  }

  function setupClickHandler() {
    if (!view) return;

    console.log('設定施工點點擊處理');

    view.on('click', function(event) {
      view.hitTest(event).then(function(response) {
        if (response.results.length > 0) {
          // 檢查是否點到施工點
          for (var i = 0; i < response.results.length; i++) {
            var result = response.results[i];
            if (result.graphic && result.graphic.attributes && result.graphic.attributes.acNo) {
              console.log('點到施工點，顯示彈窗');
              showPopup(result.graphic.attributes, event.mapPoint);
              return;  // 找到就停止
            }
          }
        }
      });
    });
  }
  function getUserLocation(callback, errorCallback) {

    try {
      if (window.Android && window.Android.getGpsPoint) {
        const gpsStr = window.Android.getGpsPoint();
        console.log("DEBUG 模擬 GPS (3826):", gpsStr);

        if (gpsStr && gpsStr.includes(",")) {
          const arr = gpsStr.split(",");
          const x = parseFloat(arr[0]);
          const y = parseFloat(arr[1]);

          if (!isNaN(x) && !isNaN(y)) {
            const wgs = twd97ToWGS84(x, y);
            console.log("使用模擬 GPS → WGS84:", wgs);
            callback(wgs.lat, wgs.lng);
            return;
          }
        }
      }
    } catch (e) {
      console.warn("模擬 GPS 失敗，改用實際 GPS", e);
    }

    if (!navigator.geolocation) {
      errorCallback("裝置不支援定位");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      pos => {
        console.log("實際 GPS:", pos.coords.latitude, pos.coords.longitude);
        callback(pos.coords.latitude, pos.coords.longitude);
      },
      err => errorCallback("定位失敗：" + err.message),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }
  function doCheckIn(acNo) {
    const now = new Date();
    const ts = now.getFullYear() + "-" +
      String(now.getMonth() + 1).padStart(2, "0") + "-" +
      String(now.getDate()).padStart(2, "0") + " " +
      String(now.getHours()).padStart(2, "0") + ":" +
      String(now.getMinutes()).padStart(2, "0");

    window.db
      .ref("TP/RLIST/" + acNo)
      .update({ Doneflag: ts })
      .then(() => {
        console.log("打卡成功:", ts);

        showMessage("巡勘打卡成功\n時間：" + ts, "成功");
      })
      .catch(err => {
        console.error("打卡失敗:", err);
        showMessage("巡勘打卡失敗\n時間：" + err, "fail");
      });
  }
  function calcDistanceMeter(lat1, lng1, lat2, lng2) {
    const R = 6378137;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);

    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function showMessage(message, type = "info") {

    // 移除舊的
    const old = document.getElementById("appMessageBox");
    if (old) old.remove();

    const box = document.createElement("div");
    box.id = "appMessageBox";

    const colors = {
      info: "#0d6efd",
      success: "#198754",
      error: "#dc3545",
      warning: "#f57c00"
    };

    box.style.position = "fixed";
    box.style.left = "50%";
    box.style.bottom = "30px";
    box.style.transform = "translateX(-50%)";
    box.style.background = colors[type] || colors.info;
    box.style.color = "#fff";
    box.style.padding = "12px 20px";
    box.style.borderRadius = "8px";
    box.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
    box.style.fontSize = "14px";
    box.style.zIndex = "999999";
    box.style.opacity = "0";
    box.style.transition = "opacity 0.3s";

    box.innerText = message;
    document.body.appendChild(box);

    // 動畫顯示
    setTimeout(() => box.style.opacity = "1", 10);

    // 3 秒自動消失
    setTimeout(() => {
      box.style.opacity = "0";
      setTimeout(() => box.remove(), 300);
    }, 3000);
  }
  function twd97ToWGS84(x, y) {
    const a = 6378137.0;
    const b = 6356752.314245;
    const lng0 = 121 * Math.PI / 180;
    const k0 = 0.9999;
    const dx = 250000;
    const dy = 0;

    x -= dx;
    y -= dy;

    const e = Math.sqrt(1 - Math.pow(b, 2) / Math.pow(a, 2));
    const M = y / k0;

    const mu = M / (a * (1 - Math.pow(e, 2) / 4 - 3 * Math.pow(e, 4) / 64 - 5 * Math.pow(e, 6) / 256));

    const e1 = (1 - Math.sqrt(1 - Math.pow(e, 2))) / (1 + Math.sqrt(1 - Math.pow(e, 2)));

    const J1 = 3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32;
    const J2 = 21 * Math.pow(e1, 2) / 16 - 55 * Math.pow(e1, 4) / 32;
    const J3 = 151 * Math.pow(e1, 3) / 96;
    const J4 = 1097 * Math.pow(e1, 4) / 512;

    const fp = mu + J1 * Math.sin(2 * mu) + J2 * Math.sin(4 * mu) +
               J3 * Math.sin(6 * mu) + J4 * Math.sin(8 * mu);

    const C1 = Math.pow(e, 2) * Math.pow(Math.cos(fp), 2) / (1 - Math.pow(e, 2));
    const T1 = Math.pow(Math.tan(fp), 2);
    const R1 = a * (1 - Math.pow(e, 2)) / Math.pow(1 - Math.pow(e, 2) * Math.pow(Math.sin(fp), 2), 1.5);
    const N1 = a / Math.sqrt(1 - Math.pow(e, 2) * Math.pow(Math.sin(fp), 2));
    const D = x / (N1 * k0);

    const lat = fp - (N1 * Math.tan(fp) / R1) *
      (Math.pow(D, 2) / 2 -
       (5 + 3 * T1 + 10 * C1 - 4 * Math.pow(C1, 2) - 9 * Math.pow(e, 2)) * Math.pow(D, 4) / 24 +
       (61 + 90 * T1 + 298 * C1 + 45 * Math.pow(T1, 2) - 252 * Math.pow(e, 2) - 3 * Math.pow(C1, 2)) * Math.pow(D, 6) / 720);

    const lng = lng0 + (D -
      (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6 +
      (5 - 2 * C1 + 28 * T1 - 3 * Math.pow(C1, 2) + 8 * Math.pow(e, 2) + 24 * Math.pow(T1, 2)) * Math.pow(D, 5) / 120) / Math.cos(fp);

    return {
      lat: lat * 180 / Math.PI,
      lng: lng * 180 / Math.PI
    };
  }

  function showPopup(attrs, mapPoint) {
    console.log('showPopup 被呼叫');
    console.log('attrs:', attrs);
    console.log('mapPoint:', mapPoint);


    if (!view || !view.popup) {
      console.error('view 或 view.popup 不存在');
      return;
    }

    var content = '<div style="padding:10px">' +
      '<div><b>路證編號：</b>' + attrs.acNo + '</div>' +
      '<div><b>施工單位：</b>' + attrs.appName + '</div>' +
      '<div><b>行政區：</b>' + attrs.cName + '</div>' +
      '<div><b>地點：</b>' + attrs.addr + '</div>' +
      '<div><b>施工起始：</b>' + attrs.cbDa + '</div>' +
      '<div><b>施工完成：</b>' + attrs.ceDa + '</div>' +
      '<div><b>施工時間：</b>' + attrs.coTi + '</div>' +
      '<div><b>施工廠商：</b>' + attrs.tcNa + '</div>' +
      '<div><b>廠商窗口：</b>' + attrs.tcMa + ' ' + attrs.tcTl + '</div>' +
      '<div><b>現場人員：</b>' + attrs.tcMa3 + ' ' + attrs.tcTl3 + '</div>' +
      '<div><b>施工目的：</b>' + attrs.nPurp + '</div>' +
      '<div><b>工項：</b>' + attrs.wItem + '</div>' +
      '<div><b>幹管數量：</b>' + attrs.pipeCount + '</div>' +
      '<div><b>巡勘備註：</b>' + attrs.note + '</div>' +
      '<div><b>巡勘日期：</b>' + attrs.doneFlag + '</div>' +
      '<div><b>簡訊發送時間：</b>' + attrs.smsSend + '</div>' +
      '</div>';

    console.log('準備打開 popup');

    try {
      // 確保 popup 可見
      view.popup.autoCloseEnabled = false;
      view.popup.dockEnabled = true;
      view.popup.dockOptions = {
        buttonEnabled: false,
        breakpoint: false
      };

      view.popup.open({
        title: '施工資訊',
        content: content,
        location: mapPoint,
        visible: true
      });

      console.log('popup.open 已呼叫');
      console.log('popup.visible:', view.popup.visible);

      // 強制顯示
      setTimeout(function() {
        if (!view.popup.visible) {
          console.log('popup 不可見，嘗試重新開啟');
          view.popup.visible = true;
        }
      }, 100);
      if (!view.popup.actions.find(a => a.id === "firebase-action")) {
        view.popup.actions.push({
          title: "Firebase 資料",
          id: "firebase-action",
          className: "esri-icon-table"
        });
      }
      if (attrs.geom) {

          // 清除舊的施工範圍
          constructionGeomLayer.removeAll();

          try {
              // 依照 polygon / polyline 畫出不同 graphic
              const graphic = new Graphic({
                  geometry: attrs.geom,
                  symbol: attrs.positionsType === "MultiPolygon"
                      ? {
                          type: "simple-fill",
                          outline: { width: 1 },
                          style: "solid",
                          color: [0, 0, 255, 0.2]  // 半透明藍色
                      }
                      : {
                          type: "simple-line",
                          width: 3,
                      }
              });

              constructionGeomLayer.add(graphic);

              console.log("施工範圍已繪製");

              // 🌟 自動縮放到施工範圍（可選）
              view.goTo(attrs.geom);

          } catch (e) {
              console.error("繪製施工 geometry 失敗:", e);
          }

      } else {
          console.warn("此筆資料沒有 geom，無法畫範圍");
      }

      // 處理按鈕點擊
      view.popup.on("trigger-action", function(event) {
        if (event.action.id === "firebase-action") {

          console.log("Firebase Action 被點擊");

          // 如果 dialog 已存在就不重複建立
          if (!document.getElementById("firebaseDialog")) {

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
            document.getElementById("surveyNote").value = (attrs.note || "");
            document.getElementById("btnSubmitNote").onclick = function() {

              var noteText = document.getElementById("surveyNote").value.trim();

              if (!noteText) {
                showMessage("請先填寫巡勘備註");
                return;
              }

              console.log("準備寫入 Firebase Note:", noteText);

              var ref = window.db.ref("TP/RLIST/" + attrs.acNo + "/Note");

              ref.set(noteText)
                .then(function() {
                  console.log("Firebase Note 更新成功:", noteText);
                  showMessage("巡勘備註已送出！");

                  // 立即同步更新 attrs
                  attrs.note = noteText;
                })
                .catch(function(err) {
                  console.error("Firebase 寫入失敗:", err);
                  showMessage("儲存失敗，請稍後再試");
                });
            };

            // 關閉事件
            document.getElementById("btnCloseDialog").onclick = function() {
              document.getElementById("firebaseDialogMask").remove();
            };

            // 🚧 目前只做 UI，不做功能
            document.getElementById("btnNavigate").onclick = function() {

                console.log("導航功能啟動");

                try {
                    var x3826 = attrs.coordinates.x;
                    var y3826 = attrs.coordinates.y;

                    console.log("原始 3826 座標:", x3826, y3826);

                    // ArcGIS Point
                    var point3826 = {
                        type: "point",
                        x: x3826,
                        y: y3826,
                        spatialReference: { wkid: 3826 }
                    };

                    // 確保 projection 有啟用
                    projection.load().then(function () {

                        // 轉換成 WGS84
                        var pointWGS84 = projection.project(point3826, { wkid: 4326 });

                        var lat = pointWGS84.latitude;
                        var lon = pointWGS84.longitude;

                        console.log("轉換後 WGS84:", lat, lon);

                        if (window.Android && window.Android.navigateToLocation) {
                            console.log("呼叫 Android 導航:", lat, lon, attrs.acNo);
                            window.Android.navigateToLocation(lat, lon, attrs.acNo);
                        } else {
                            console.error("Android.navigateToLocation 未找到");
                            showMessage("Android App 不支援導航功能");
                        }

                    });

                } catch (err) {
                    console.error("導航轉換錯誤:", err);
                    showMessage("導航失敗：" + err.message);
                }
            };

            document.getElementById("btnCheckin").onclick = function() {
              //alert("（規劃中）施工巡勘啟動");
              console.log("🚩 巡勘打卡啟動");

                getUserLocation(
                  function (userLat, userLng) {

                    const sx = attrs.coordinates.x;
                    const sy = attrs.coordinates.y;

                    const site = twd97ToWGS84(sx, sy);

                    console.log("使用者:", userLat, userLng);
                    console.log("施工點:", site.lat, site.lng);

                    const dist = calcDistanceMeter(
                      userLat, userLng,
                      site.lat, site.lng
                    );

                    console.log("距離:", dist, "m");

                    if (dist <= 50) {
                      doCheckIn(attrs.acNo);
                    } else {
                      showMessage("距離施工點 " + Math.round(dist) + " 公尺，超出 50 公尺");
                    }
                  },
                  function(msg) {
                    showMessage(msg);
                  }
                );


            };

            document.getElementById("btnSms").onclick = function() {
              showSmsDialog(attrs);
            };
          }
        }
      });

    } catch (e) {
      console.error('開啟 popup 失敗:', e.message || e);
    }
  }

  // 簡訊發送功能
  function showSmsDialog(attrs) {
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

    // 中華電信 (股長)
    if (attrs.master && attrs.mphone) {
      recipients.push({
        category: "中華電信",
        name: attrs.master + " 股長",
        phone: attrs.mphone,
        isCHT: true
      });
    }

    // 負責人 (中華電信)
    if (attrs.owner && attrs.ophone) {
      recipients.push({
        category: "負責人",
        name: attrs.owner,
        phone: attrs.ophone,
        isCHT: true
      });
    }

    // 負責人2 (中華電信)
    if (attrs.owner2 && attrs.ophone2) {
      recipients.push({
        category: "負責人2",
        name: attrs.owner2,
        phone: attrs.ophone2,
        isCHT: true
      });
    }

    // 施工廠商 (非中華電信)
    if (attrs.tcMa3 && attrs.tcTl3) {
      recipients.push({
        category: "施工廠商",
        name: attrs.tcMa3,
        phone: attrs.tcTl3,
        isCHT: false
      });
    }

    // 委託單位 (非中華電信)
    if (attrs.tcMa && attrs.tcTl) {
      recipients.push({
        category: "委託單位",
        name: attrs.tcMa,
        phone: attrs.tcTl,
        isCHT: false
      });
    }

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
        <div style="padding: 8px; border-bottom: 1px solid #eee;">
          <label style="display: flex; align-items: center; cursor: pointer;">
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

    // 更新簡訊內容區域
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

      var smsContentArea = document.getElementById("smsContentArea");
      var contentHtml = "";

      // 產生 Google Maps 定位 URL
      var x3826 = attrs.coordinates.x;
      var y3826 = attrs.coordinates.y;
      var wgs84 = twd97ToWGS84(x3826, y3826);
      var vDirectionUrl = "https://www.google.com/maps?q=" + wgs84.lat + "," + wgs84.lng;

      // 中華電信簡訊內容
      if (hasCHT) {
        var chtMessage = "路證編號:" + attrs.acNo + "於今日施工，請派員前往巡查，施工地點:" + vDirectionUrl;
        contentHtml += `
          <div style="margin-bottom: 12px; padding: 10px; background: #e7f3ff; border-radius: 6px; border: 1px solid #b3d9ff;">
            <label style="font-weight: bold; color: #0056b3; display: block; margin-bottom: 6px;">中華電信簡訊內容：</label>
            <textarea id="chtSmsContent" style="width: 100%; height: 80px; padding: 6px; border-radius: 4px; border: 1px solid #b3d9ff; font-size: 13px; font-family: Arial, sans-serif;">${chtMessage}</textarea>
          </div>
        `;
      }

      // 非中華電信簡訊內容
      if (hasNonCHT) {
        var ownerName = attrs.owner || "";
        var ownerPhone = attrs.ophone || "";
        var nonChtMessage = "您好，路證編號:" + attrs.acNo + "施工範圍附近底下有中華電信重要管線，請小心施工開挖，如需協助請通知本公司轄區負責窗口 " + ownerName + " " + ownerPhone;
        contentHtml += `
          <div style="margin-bottom: 12px; padding: 10px; background: #fff4e6; border-radius: 6px; border: 1px solid #ffd699;">
            <label style="font-weight: bold; color: #cc6600; display: block; margin-bottom: 6px;">非中華電信簡訊內容：</label>
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

  // 發送簡訊功能
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

  // 發送單一簡訊
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

  // 所有簡訊發送完成後的處理
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

      var ref = window.db.ref("TP/RLIST/" + acNo + "/SMS-send");

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

  window.TaipeiConstructionModule = {
    init: init,
    setPipeLayerUrl: setPipeLayerUrl,
    loadConstructionData: loadConstructionData,
    processConstructionData: processConstructionData,
    selectDistrict: selectDistrict
  };

  console.log('TaipeiConstructionModule 已掛載:', !!window.TaipeiConstructionModule);
})();