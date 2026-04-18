const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const {
  deployHexaPayFixture,
  encrypt128,
  encrypt128Array,
  hashText,
  randomPublicKey,
  registerCompany,
  sendAndParseEvent,
  unseal,
  wrapAmount
} = require("./helpers/hexapay");

describe("HexaPay policy engine", function () {
  async function createBaseFixture() {
    return loadFixture(deployHexaPayFixture);
  }

  async function createPayrollSchedule(workflow, employer, employees, amounts, frequency = 3600) {
    const firstPaymentAt = (await time.latest()) + 100;

    const scheduleArgs = await sendAndParseEvent(
      workflow.connect(employer).createPayrollSchedule(
        employer.address,
        employees.map((employee) => employee.address),
        await encrypt128Array(amounts),
        frequency,
        firstPaymentAt,
        hashText("payroll-schedule")
      ),
      workflow,
      "PayrollScheduleCreated"
    );

    return scheduleArgs.scheduleId;
  }

  async function createInvoiceForPolicy(workflow, issuer, payer, amount) {
    const invoiceArgs = await sendAndParseEvent(
      workflow.connect(issuer).createInvoice(
        issuer.address,
        payer.address,
        await encrypt128(amount),
        hashText("policy-invoice"),
        (await time.latest()) + 86400
      ),
      workflow,
      "InvoiceCreated"
    );

    return invoiceArgs.invoiceId;
  }

  it("lets a company owner configure policy rules", async function () {
    const { hexaPay, owner, workflow } = await createBaseFixture();

    await registerCompany(hexaPay, owner, "acme-policy");
    await workflow.connect(owner).setPolicyRule(owner.address, 0, 2, 3600, true);

    const rule = await workflow.getPolicyRule(owner.address, 0);
    expect(rule.minApprovals).to.equal(2n);
    expect(rule.approvalTtl).to.equal(3600n);
    expect(rule.active).to.equal(true);
  });

  it("lets a company owner scope signer permissions per action", async function () {
    const { hexaPay, owner, signer, workflow } = await createBaseFixture();

    await registerCompany(hexaPay, owner, "acme-signer");
    await hexaPay.connect(owner).addSigner(signer.address);
    await workflow.connect(owner).setSignerActionPermission(signer.address, 0, true);

    expect(
      await workflow.isSignerAuthorizedForAction(owner.address, signer.address, 0)
    ).to.equal(true);
    expect(
      await workflow.isSignerAuthorizedForAction(owner.address, signer.address, 1)
    ).to.equal(false);
  });

  it("blocks direct payroll execution when payroll policy is active", async function () {
    const { employee, hexaPay, owner, token, workflow } = await createBaseFixture();

    await registerCompany(hexaPay, owner, "acme-payroll-block");
    await wrapAmount(token, hexaPay, owner, owner, 500n);

    const scheduleId = await createPayrollSchedule(workflow, owner, [employee], [100n]);
    await workflow.connect(owner).setPolicyRule(owner.address, 1, 1, 3600, true);

    const schedule = await workflow.getPayrollSchedule(scheduleId);
    await time.increaseTo(Number(schedule.nextPaymentAt) + 1);

    await expect(
      workflow.connect(owner).executePayroll(scheduleId)
    ).to.be.revertedWithCustomError(workflow, "PolicyApprovalRequired");
  });

  it("executes payroll through a pending action after enough approvals", async function () {
    const { analytics, employee, hexaPay, owner, signer, token, workflow } =
      await createBaseFixture();
    const publicKey = randomPublicKey();

    await registerCompany(hexaPay, owner, "acme-payroll-exec");
    await hexaPay.connect(owner).addSigner(signer.address);
    await workflow.connect(owner).setSignerActionPermission(signer.address, 1, true);
    await workflow.connect(owner).setPolicyRule(owner.address, 1, 2, 3600, true);
    await wrapAmount(token, hexaPay, owner, owner, 500n);

    const scheduleId = await createPayrollSchedule(workflow, owner, [employee], [100n]);
    const schedule = await workflow.getPayrollSchedule(scheduleId);
    await time.increaseTo(Number(schedule.nextPaymentAt) + 1);

    const actionArgs = await sendAndParseEvent(
      workflow.connect(owner).proposePayrollExecution(scheduleId, hashText("run-1")),
      workflow,
      "PendingActionProposed"
    );
    const actionId = actionArgs.actionId;

    let action = await workflow.getPendingAction(actionId);
    expect(action.approvalCount).to.equal(1n);

    await workflow.connect(signer).approvePendingAction(actionId);
    const executionArgs = await sendAndParseEvent(
      workflow.connect(signer).executePendingAction(actionId),
      workflow,
      "PendingActionExecuted"
    );

    action = await workflow.getPendingAction(actionId);
    const sealedEmployeeBalance = await hexaPay.connect(employee).getSealedBalance(publicKey);
    const sealedRunTotal = await analytics
      .connect(owner)
      .getSealedPayrollRunTotal(scheduleId, publicKey);

    expect(executionArgs.actionId).to.equal(actionId);
    expect(action.executed).to.equal(true);
    expect(await unseal(hexaPay, sealedEmployeeBalance, employee)).to.equal(100n);
    expect(await unseal(analytics, sealedRunTotal, owner)).to.equal(100n);
  });

  it("blocks direct invoice payment when invoice payment policy is active", async function () {
    const { hexaPay, owner, payer, token, workflow } = await createBaseFixture();

    await registerCompany(hexaPay, owner, "issuer-policy");
    await registerCompany(hexaPay, payer, "payer-policy");
    await wrapAmount(token, hexaPay, owner, payer, 500n);

    const invoiceId = await createInvoiceForPolicy(workflow, owner, payer, 100n);
    await workflow.connect(payer).approveInvoice(invoiceId);
    await workflow.connect(payer).setPolicyRule(payer.address, 0, 1, 3600, true);

    await expect(
      workflow.connect(payer).payInvoice(invoiceId, await encrypt128(100n))
    ).to.be.revertedWithCustomError(workflow, "PolicyApprovalRequired");
  });

  it("executes invoice payment through a pending action", async function () {
    const { owner, payer, signer, token, workflow, hexaPay } = await createBaseFixture();
    const publicKey = randomPublicKey();

    await registerCompany(hexaPay, owner, "issuer-policy-exec");
    await registerCompany(hexaPay, payer, "payer-policy-exec");
    await hexaPay.connect(payer).addSigner(signer.address);
    await workflow.connect(payer).setSignerActionPermission(signer.address, 0, true);
    await workflow.connect(payer).setPolicyRule(payer.address, 0, 2, 3600, true);
    await wrapAmount(token, hexaPay, owner, payer, 500n);

    const invoiceId = await createInvoiceForPolicy(workflow, owner, payer, 100n);
    await workflow.connect(payer).approveInvoice(invoiceId);

    const actionArgs = await sendAndParseEvent(
      workflow.connect(payer).proposeInvoicePayment(
        invoiceId,
        await encrypt128(100n),
        hashText("invoice-action")
      ),
      workflow,
      "PendingActionProposed"
    );
    const actionId = actionArgs.actionId;

    await workflow.connect(signer).approvePendingAction(actionId);
    const executionArgs = await sendAndParseEvent(
      workflow.connect(signer).executePendingAction(actionId),
      workflow,
      "PendingActionExecuted"
    );

    const invoice = await workflow.connect(owner).getInvoice(invoiceId);
    const invoicePayments = await workflow.connect(owner).getInvoicePayments(invoiceId);
    const sealedOutstanding = await workflow
      .connect(owner)
      .getSealedInvoiceOutstanding(invoiceId, publicKey);
    const action = await workflow.connect(payer).getPendingAction(actionId);

    expect(action.executed).to.equal(true);
    expect(invoice.status).to.equal(3n);
    expect(await unseal(workflow, sealedOutstanding, owner)).to.equal(0n);
    expect(invoicePayments).to.deep.equal([executionArgs.resultId]);
  });

  it("blocks direct invoice cancellation when cancellation policy is active", async function () {
    const { hexaPay, owner, payer, workflow } = await createBaseFixture();

    await registerCompany(hexaPay, owner, "issuer-cancel");
    const invoiceId = await createInvoiceForPolicy(workflow, owner, payer, 100n);

    await workflow.connect(owner).setPolicyRule(owner.address, 2, 1, 3600, true);

    await expect(
      workflow.connect(owner).cancelInvoice(invoiceId)
    ).to.be.revertedWithCustomError(workflow, "PolicyApprovalRequired");
  });

  it("prevents unauthorized signers from approving or executing pending actions", async function () {
    const { employee, hexaPay, outsider, owner, signer, token, workflow } =
      await createBaseFixture();

    await registerCompany(hexaPay, owner, "acme-unauthorized");
    await hexaPay.connect(owner).addSigner(signer.address);
    await workflow.connect(owner).setSignerActionPermission(signer.address, 1, true);
    await workflow.connect(owner).setPolicyRule(owner.address, 1, 2, 3600, true);
    await wrapAmount(token, hexaPay, owner, owner, 500n);

    const scheduleId = await createPayrollSchedule(workflow, owner, [employee], [100n]);
    const schedule = await workflow.getPayrollSchedule(scheduleId);
    await time.increaseTo(Number(schedule.nextPaymentAt) + 1);

    const actionArgs = await sendAndParseEvent(
      workflow.connect(owner).proposePayrollExecution(scheduleId, hashText("unauthorized")),
      workflow,
      "PendingActionProposed"
    );
    const actionId = actionArgs.actionId;

    await expect(
      workflow.connect(outsider).approvePendingAction(actionId)
    ).to.be.revertedWithCustomError(workflow, "NotPolicySigner");
    await expect(
      workflow.connect(outsider).executePendingAction(actionId)
    ).to.be.revertedWithCustomError(workflow, "NotPolicySigner");
  });

  it("prevents expired pending actions from executing", async function () {
    const { employee, hexaPay, owner, signer, token, workflow } = await createBaseFixture();

    await registerCompany(hexaPay, owner, "acme-expired");
    await hexaPay.connect(owner).addSigner(signer.address);
    await workflow.connect(owner).setSignerActionPermission(signer.address, 1, true);
    await workflow.connect(owner).setPolicyRule(owner.address, 1, 2, 1, true);
    await wrapAmount(token, hexaPay, owner, owner, 500n);

    const scheduleId = await createPayrollSchedule(workflow, owner, [employee], [100n]);
    const schedule = await workflow.getPayrollSchedule(scheduleId);
    await time.increaseTo(Number(schedule.nextPaymentAt) + 1);

    const actionArgs = await sendAndParseEvent(
      workflow.connect(owner).proposePayrollExecution(scheduleId, hashText("expired")),
      workflow,
      "PendingActionProposed"
    );
    const actionId = actionArgs.actionId;

    await time.increase(2);

    await expect(
      workflow.connect(owner).executePendingAction(actionId)
    ).to.be.revertedWithCustomError(workflow, "ActionExpired");
  });
});
