<figure data-reveal="mockup" role="img" aria-label="Окно приложения M3tr0VPN: слева меню «Статус», «Туннелирование» и «Настройки», в центре — большая кнопка питания со статусом «Защищено», плитки загрузки, отдачи и сессии, справа — список серверов по подпискам." class="revealed">
        <div class="window-persp">
          <div class="window" aria-hidden="true">

            <!-- титлбар -->
            <div class="titlebar">
              <svg class="logo-svg" viewBox="0 0 48 48"><use href="#m3-logo"></use></svg>
              <p class="title">M3tr0<b>VPN</b><span class="extra">— Amsterdam #1</span></p>

              <span class="status-chip">
                <svg class="icon"><use href="#i-wifi"></use></svg>
                <span class="txt">Защищено</span>
              </span>

              <span class="lang">
                <span class="ru">RU</span>
                <span class="en">EN</span>
              </span>

              <span class="win-btns">
                <span><svg class="icon"><use href="#i-minus"></use></svg></span>
                <span><svg class="icon small"><use href="#i-copy"></use></svg></span>
                <span><svg class="icon"><use href="#i-x"></use></svg></span>
              </span>
              <span class="traffic" aria-hidden="true">
                <span class="amber"></span>
                <span class="green"></span>
                <span class="red"></span>
              </span>
            </div>

            <!-- тело окна -->
            <div class="window-body">
              <!-- сайдбар -->
              <nav class="sidebar">
                <p class="dir">~/m3tr0</p>
                <ul>
                  <li>
                    <span class="active">
                      <svg class="icon"><use href="#i-gauge"></use></svg>
                      Статус
                      <span class="dot"></span>
                    </span>
                  </li>
                  <li>
                    <span>
                      <svg class="icon"><use href="#i-split"></use></svg>
                      Туннелирование
                    </span>
                  </li>
                  <li>
                    <span>
                      <svg class="icon"><use href="#i-settings-2"></use></svg>
                      Настройки
                    </span>
                  </li>
                </ul>

                <div class="core-box">
                  <p><span class="dot"></span>xray-core 26.3.27</p>
                  <p>ядро запущено</p>
                </div>
              </nav>

              <!-- центр -->
              <div class="center">
                <div class="top">
                  <span class="power-wrap">
                    <span class="power-ring"></span>
                    <span class="power-btn">
                      <svg class="icon"><use href="#i-power"></use></svg>
                    </span>
                  </span>

                  <span class="status-block">
                    <span class="state">Защищено</span>
                    <span class="route">через <b>Amsterdam #1</b> · <i>VLESS</i> · Системный прокси</span>
                    <span class="hint">Готово · трафик шифруется</span>
                  </span>
                </div>

                <!-- плитки -->
                <div class="tiles">
                  <div class="tile">
                    <div class="head">
                      <svg class="icon"><use href="#i-arrow-down"></use></svg>
                      <span>Загрузка</span>
                    </div>
                    <p class="val">84.2<small>Мбит/с</small></p>
                  </div>
                  <div class="tile">
                    <div class="head">
                      <svg class="icon accent"><use href="#i-arrow-up"></use></svg>
                      <span>Отдача</span>
                    </div>
                    <p class="val">23.7<small>Мбит/с</small></p>
                  </div>
                  <div class="tile">
                    <div class="head">
                      <svg class="icon"><use href="#i-clock"></use></svg>
                      <span>Сессия</span>
                    </div>
                    <p class="val">01:42:05</p>
                  </div>
                </div>

                <!-- мини-график скорости -->
                <div class="chart-box">
                  <span class="head">
                    Скорость в реальном времени
                    <span class="legend"><span class="down">↓ 84.2</span> <span class="up">↑ 23.7</span> Мбит/с</span>
                  </span>
                  <svg viewBox="0 0 300 48" preserveAspectRatio="none" focusable="false">
                    <defs>
                      <linearGradient id="m3-mock-area" x1="0" y1="0" x2="0" y2="1">
                        <stop stop-color="#00cc6a" stop-opacity="0.28"></stop>
                        <stop offset="1" stop-color="#00cc6a" stop-opacity="0"></stop>
                      </linearGradient>
                    </defs>
                    <path d="M0,38 C20,36 30,30 45,31 S70,40 85,34 S115,18 130,22 S160,30 175,20 S205,10 220,16 S250,26 265,14 S285,20 300,12 L300,48 L0,48 Z" fill="url(#m3-mock-area)"></path>
                    <path d="M0,38 C20,36 30,30 45,31 S70,40 85,34 S115,18 130,22 S160,30 175,20 S205,10 220,16 S250,26 265,14 S285,20 300,12" stroke="#00cc6a" stroke-width="1.6" fill="none"></path>
                    <path d="M0,44 C25,43 40,40 60,41 S100,44 120,42 S160,36 180,38 S220,42 245,39 S275,42 300,38" stroke="#4ae3ff" stroke-opacity="0.75" stroke-width="1.3" fill="none"></path>
                  </svg>
                </div>

                <!-- мини-журнал ядра -->
                <div class="core-log">
                  <p><span class="time">[21:04:12]</span><span class="line-ok">xray-core 26.3.27 · старт</span></p>
                  <p><span class="time">[21:04:13]</span><span class="line-dim">socks://127.0.0.1:10808 · inbound готов</span></p>
                  <p class="hide-sm"><span class="time">[21:04:14]</span><span class="line-dim">vless+reality → nl1.dm3tr0.ru:443 · handshake ok</span></p>
                </div>
              </div>

              <!-- правая панель: подписки -->
              <aside class="right-panel">
                <div class="head">
                  <span class="t">Подписки</span>
                  <span class="count"><svg class="icon"><use href="#i-radar"></use></svg>6</span>
                </div>

                <div class="list">
                  <div class="group">
                    <p class="g-name">M3tr0 Premium</p>
                    <ul>
                      <li class="server current">
                        <span class="country-chip">NL</span>
                        <span class="info">
                          <span class="row">
                            <span class="name">Amsterdam #1</span>
                            <svg class="icon check"><use href="#i-check"></use></svg>
                          </span>
                          <span class="ping">38 мс</span>
                        </span>
                        <span class="protocol-chip vless">VLESS</span>
                      </li>
                      <li class="server">
                        <span class="country-chip">DE</span>
                        <span class="info">
                          <span class="row"><span class="name">Frankfurt #2</span></span>
                          <span class="ping">52 мс</span>
                        </span>
                        <span class="protocol-chip vmess">VMess</span>
                      </li>
                      <li class="server">
                        <span class="country-chip">FI</span>
                        <span class="info">
                          <span class="row"><span class="name">Helsinki #3</span></span>
                          <span class="ping">31 мс</span>
                        </span>
                        <span class="protocol-chip trojan">Trojan</span>
                      </li>
                      <li class="server">
                        <span class="country-chip">SE</span>
                        <span class="info">
                          <span class="row"><span class="name">Stockholm #4</span></span>
                          <span class="ping">44 мс</span>
                        </span>
                        <span class="protocol-chip vless">VLESS</span>
                      </li>
                    </ul>
                  </div>

                  <div class="group">
                    <p class="g-name">M3tr0 Free</p>
                    <ul>
                      <li class="server">
                        <span class="country-chip">NL</span>
                        <span class="info">
                          <span class="row"><span class="name">Free Amsterdam</span></span>
                          <span class="ping">95 мс</span>
                        </span>
                        <span class="protocol-chip ss">SS</span>
                      </li>
                      <li class="server">
                        <span class="country-chip">FR</span>
                        <span class="info">
                          <span class="row"><span class="name">Free Paris</span></span>
                          <span class="ping">88 мс</span>
                        </span>
                        <span class="protocol-chip vmess">VMess</span>
                      </li>
                    </ul>
                  </div>
                </div>

                <div class="add">
                  <span><svg class="icon"><use href="#i-plus"></use></svg>Добавить сервер</span>
                </div>
              </aside>
            </div>
          </div>
        </div>

        <figcaption class="figcaption">
          <span class="slash" aria-hidden="true">//</span>
          три вкладки
          и ничего лишнего
        </figcaption>
      </figure>
