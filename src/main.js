function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", (event) => {
      const target = document.querySelector(anchor.getAttribute("href"));

      if (!target) {
        return;
      }

      event.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function initNavScrollEffect() {
  const productNav = document.querySelector(".hp-nav");
  const legacyNav = document.querySelector(".nav");

  if (!productNav && !legacyNav) {
    return;
  }

  window.addEventListener("scroll", () => {
    const currentScroll = window.pageYOffset;

    if (productNav) {
      productNav.classList.toggle("is-scrolled", currentScroll > 24);
    }

    if (legacyNav) {
      if (currentScroll > 50) {
        legacyNav.style.background = "rgba(10, 14, 26, 0.95)";
        legacyNav.style.boxShadow = "0 4px 30px rgba(0, 0, 0, 0.5)";
      } else {
        legacyNav.style.background = "rgba(10, 14, 26, 0.8)";
        legacyNav.style.boxShadow = "none";
      }
    }
  });
}

function initIntersectionAnimations() {
  const revealElements = document.querySelectorAll("[data-reveal]");
  const animatedCards = document.querySelectorAll(".feature-card, .solution-card, .arch-card, .stat-card");

  if (!revealElements.length && !animatedCards.length) {
    return;
  }

  if (!("IntersectionObserver" in window)) {
    revealElements.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        if (entry.target.hasAttribute("data-reveal")) {
          entry.target.classList.add("is-visible");
        } else {
          entry.target.style.opacity = "1";
          entry.target.style.transform = "translateY(0)";
        }
      });
    },
    {
      threshold: 0.1,
      rootMargin: "0px 0px -50px 0px",
    },
  );

  revealElements.forEach((element) => observer.observe(element));

  animatedCards.forEach((element) => {
    element.style.opacity = "0";
    element.style.transform = "translateY(30px)";
    element.style.transition = "all 0.6s ease-out";
    observer.observe(element);
  });
}

function animateCounter(element, target, suffix = "") {
  let current = 0;
  const increment = target / 60;

  const timer = window.setInterval(() => {
    current += increment;

    if (current >= target) {
      element.textContent = Math.round(target) + suffix;
      window.clearInterval(timer);
      return;
    }

    element.textContent = Math.round(current) + suffix;
  }, 30);
}

function initStatsCounters() {
  const statCards = document.querySelectorAll(".stat-card");

  if (!statCards.length || !("IntersectionObserver" in window)) {
    return;
  }

  const statsObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        const valueElement = entry.target.querySelector("[data-target]");

        if (valueElement) {
          const target = Number.parseFloat(valueElement.dataset.target || "0");
          const parent = valueElement.closest(".stat-value");
          const suffix = parent ? parent.textContent.replace(/[0-9.]/g, "") : "";
          animateCounter(valueElement, target, suffix);
        }

        statsObserver.unobserve(entry.target);
      });
    },
    { threshold: 0.5 },
  );

  statCards.forEach((card) => statsObserver.observe(card));
}

function initFloatingCards() {
  document.querySelectorAll(".floating-card").forEach((card, index) => {
    card.style.animationDelay = `${index * 2}s`;
  });
}

function initHexaPayEntryContext() {
  const context = document.querySelector("[data-entry-context]");
  const badge = document.querySelector("[data-entry-badge]");

  if (!context && !badge) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const entry = params.get("entry");

  if (entry === "launch-app") {
    if (context) {
      context.innerHTML =
        'Opened from <strong>Launch App</strong>. This HexaPay app continues into live confidential balance, encrypted payment, company, and invoice operations.';
    }

    if (badge) {
      badge.textContent = "HexaPay Launch App";
    }
    return;
  }

  if (entry === "homepage") {
    if (context) {
      context.innerHTML =
        'Opened from the <strong>HexaPay product homepage</strong>. This workspace continues into live treasury, invoice, and controlled disclosure operations.';
    }

    if (badge) {
      badge.textContent = "HexaPay Workspace";
    }
    return;
  }

  if (entry === "shieldpay") {
    if (context) {
      context.innerHTML =
        'Opened from <strong>ShieldPay</strong>. HexaPay continues the same product flow into contract operations, encrypted reads, and module control.';
    }

    if (badge) {
      badge.textContent = "HexaPay via ShieldPay";
    }
    return;
  }

  if (context) {
    context.textContent = "HexaPay is the secure workspace for treasury, invoices, and controlled disclosure operations.";
  }

  if (badge) {
    badge.textContent = "HexaPay Workspace";
  }
}

async function initHexaPayWorkspace() {
  const root = document.querySelector("[data-hexapay-app]");

  if (!root) {
    return;
  }

  const { initHexaPayPage } = await import("./hexapay.js");
  await initHexaPayPage(root);
}

async function initHexaPayLaunchApp() {
  const root = document.querySelector("[data-hexapay-launch-app]");

  if (!root) {
    return;
  }

  const { initHexaPayLaunchApp: initHexaPayLaunchAppPage } = await import("./hexapay-launch.js");
  await initHexaPayLaunchAppPage(root);
}

async function bootstrap() {
  initSmoothScroll();
  initNavScrollEffect();
  initIntersectionAnimations();
  initStatsCounters();
  initFloatingCards();
  initHexaPayEntryContext();
  await initHexaPayLaunchApp();
  await initHexaPayWorkspace();

  if (document.querySelector(".nav")) {
    console.log("🛡️ ShieldPay initialized - Powered by Fhenix FHE");
  }

  if (document.querySelector(".hp-nav")) {
    console.log("⬢ HexaPay homepage initialized");
  }

  if (document.querySelector("[data-hexapay-launch-app]")) {
    console.log("⬢ HexaPay app initialized");
  }

  if (document.querySelector("[data-hexapay-app]")) {
    console.log("🧩 HexaPay workspace initialized");
  }
}

bootstrap();
