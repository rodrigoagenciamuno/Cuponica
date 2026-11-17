-- Cuponica — schema MySQL 8
-- Rodar com: npm run db:migrate

CREATE TABLE IF NOT EXISTS stores (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug          VARCHAR(120) NOT NULL UNIQUE,         -- URL fixa: /cupom-desconto/{slug}. Nunca alterar depois de publicada.
  name          VARCHAR(160) NOT NULL,
  website_url   VARCHAR(500) NOT NULL,                -- página inicial da loja (destino padrão do deeplink)
  network       VARCHAR(30)  NOT NULL DEFAULT 'rakuten', -- rakuten | awin | lomadee | ...
  network_mid   VARCHAR(40)  NULL,                    -- ID do anunciante na rede (MID na Rakuten)
  logo_url      VARCHAR(500) NULL,
  intro         TEXT NULL,                            -- texto editorial curto (topo da página)
  about         MEDIUMTEXT NULL,                      -- texto editorial longo (SEO)
  faq_json      JSON NULL,                            -- [{"q": "...", "a": "..."}]
  active        TINYINT(1) NOT NULL DEFAULT 1,
  featured      TINYINT(1) NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_network_mid (network, network_mid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
  id     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug   VARCHAR(120) NOT NULL UNIQUE,
  name   VARCHAR(160) NOT NULL,
  intro  TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS store_categories (
  store_id    INT UNSIGNED NOT NULL,
  category_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (store_id, category_id),
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS coupons (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id      INT UNSIGNED NOT NULL,
  source        VARCHAR(30) NOT NULL DEFAULT 'manual', -- manual | rakuten | ...
  external_id   VARCHAR(191) NULL,                     -- chave estável vinda da rede, para atualizar sem duplicar
  type          ENUM('code','deal') NOT NULL DEFAULT 'code', -- code = tem código; deal = oferta sem código
  title         VARCHAR(255) NOT NULL,
  description   TEXT NULL,
  code          VARCHAR(80) NULL,
  discount_label VARCHAR(40) NULL,                     -- ex.: "15% OFF", "R$ 50", "Frete grátis"
  tracking_url  VARCHAR(1000) NULL,                    -- link de afiliado vindo da rede (recebe u1 no redirect)
  landing_url   VARCHAR(1000) NULL,                    -- página específica da loja para deeplink
  starts_at     DATETIME NULL,
  expires_at    DATETIME NULL,
  verified      TINYINT(1) NOT NULL DEFAULT 0,
  exclusive     TINYINT(1) NOT NULL DEFAULT 0,
  priority      INT NOT NULL DEFAULT 0,                -- maior = aparece primeiro
  active        TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_source_external (source, external_id),
  KEY idx_store_active (store_id, active, expires_at),
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Um registro por clique em /ir/{id}. O id vai para a rede como sub-ID (u1 na Rakuten).
CREATE TABLE IF NOT EXISTS clicks (
  id            CHAR(22) PRIMARY KEY,                  -- click_id
  coupon_id     INT UNSIGNED NULL,
  store_id      INT UNSIGNED NOT NULL,
  page_path     VARCHAR(500) NULL,                     -- página onde o clique aconteceu
  referrer      VARCHAR(500) NULL,                     -- de onde o visitante chegou ao site
  utm_source    VARCHAR(120) NULL,
  utm_medium    VARCHAR(120) NULL,
  utm_campaign  VARCHAR(160) NULL,
  device        VARCHAR(20) NULL,                      -- mobile | desktop | tablet | bot
  ip_hash       CHAR(64) NULL,                         -- IP com hash (LGPD: não guardamos o IP puro)
  user_agent    VARCHAR(400) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_store_date (store_id, created_at),
  KEY idx_coupon_date (coupon_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Vendas e comissões reportadas pela rede, ligadas ao clique pelo sub-ID.
CREATE TABLE IF NOT EXISTS conversions (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  network         VARCHAR(30) NOT NULL,
  network_txn_id  VARCHAR(120) NOT NULL,
  click_id        CHAR(22) NULL,
  store_id        INT UNSIGNED NULL,
  order_amount    DECIMAL(12,2) NULL,
  commission      DECIMAL(12,2) NULL,
  currency        CHAR(3) NOT NULL DEFAULT 'BRL',
  status          VARCHAR(30) NOT NULL DEFAULT 'pending', -- pending | approved | reversed
  transaction_at  DATETIME NULL,
  raw_json        JSON NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_network_txn (network, network_txn_id),
  KEY idx_click (click_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
