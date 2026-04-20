// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "forge-std/Test.sol";
import {PrivateMerchantQuote} from "../src/PrivateMerchantQuote.sol";

contract MockCreditAdapter {
    bool public forceApprove = true;

    event CreditConsumed(address indexed user, bytes32 indexed amountCt);

    function setForceApprove(bool v) external {
        forceApprove = v;
    }

    function canSpend(address, bytes32) external view returns (bool) {
        return forceApprove;
    }

    function consume(address user, bytes32 amountCt) external {
        require(forceApprove, "InsufficientCredit");
        emit CreditConsumed(user, amountCt);
    }
}

contract PrivateMerchantQuoteTest is Test {
    PrivateMerchantQuote internal quote;
    MockCreditAdapter internal credit;

    address internal merchant = address(0x1001);
    address internal payer = address(0x1002);
    address internal other = address(0x1003);

    bytes32 internal quoteId;
    uint64 internal expiry;

    function setUp() public {
        credit = new MockCreditAdapter();
        quote = new PrivateMerchantQuote(address(credit));

        quoteId = keccak256("QUOTE_1");
        expiry = uint64(block.timestamp + 1 days);
    }

    function _mockEncryptedAmount(uint64 value) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("enc_amount", value));
    }

    function _createQuote() internal returns (bytes32 amountCt) {
        amountCt = _mockEncryptedAmount(100);

        vm.prank(merchant);
        quote.createQuote(
            quoteId,
            payer,
            amountCt,
            expiry
        );
    }

    function test_CreateQuote_Success() public {
        _createQuote();

        (
            address storedMerchant,
            address storedPayer,
            uint64 storedExpiry,
            uint8 status,
            bool accessGranted
        ) = quote.getQuote(quoteId);

        assertEq(storedMerchant, merchant);
        assertEq(storedPayer, payer);
        assertEq(storedExpiry, expiry);
        assertEq(status, 1);
        assertEq(accessGranted, false);
    }

    function test_GrantAccess_Success() public {
        _createQuote();

        vm.prank(merchant);
        quote.grantAccess(quoteId, payer);

        (, , , , bool accessGranted) = quote.getQuote(quoteId);
        assertTrue(accessGranted);
    }

    function test_SettleQuote_Success() public {
        _createQuote();

        vm.prank(merchant);
        quote.grantAccess(quoteId, payer);

        vm.prank(payer);
        quote.settleQuote(quoteId, false);

        (, , , uint8 status, ) = quote.getQuote(quoteId);
        assertEq(status, 2);
    }

    function test_SettleQuote_Success_WithSkipPreview() public {
        _createQuote();

        vm.prank(payer);
        quote.settleQuote(quoteId, true);

        (, , , uint8 status, ) = quote.getQuote(quoteId);
        assertEq(status, 2);
    }

    function test_SettleQuote_RevertWhenWrongPayer() public {
        _createQuote();

        vm.prank(merchant);
        quote.grantAccess(quoteId, payer);

        vm.prank(other);
        vm.expectRevert(PrivateMerchantQuote.NotAuthorized.selector);
        quote.settleQuote(quoteId, false);
    }

    function test_SettleQuote_RevertWhenExpired() public {
        _createQuote();

        vm.warp(block.timestamp + 2 days);

        vm.prank(payer);
        vm.expectRevert(PrivateMerchantQuote.Expired.selector);
        quote.settleQuote(quoteId, true);
    }

    function test_SettleQuote_RevertWhenNoAccessAndNoSkipPreview() public {
        _createQuote();

        vm.prank(payer);
        vm.expectRevert(PrivateMerchantQuote.NotAuthorized.selector);
        quote.settleQuote(quoteId, false);
    }

    function test_SettleQuote_RevertWhenInsufficientCredit() public {
        _createQuote();

        credit.setForceApprove(false);

        vm.prank(merchant);
        quote.grantAccess(quoteId, payer);

        vm.prank(payer);
        vm.expectRevert(PrivateMerchantQuote.InvalidState.selector);
        quote.settleQuote(quoteId, false);
    }

    function test_CreateQuote_RevertOnDuplicateId() public {
        _createQuote();

        bytes32 amountCt2 = _mockEncryptedAmount(200);

        vm.prank(merchant);
        vm.expectRevert(PrivateMerchantQuote.AlreadyExists.selector);
        quote.createQuote(
            quoteId,
            payer,
            amountCt2,
            expiry
        );
    }

    function test_GrantAccess_RevertWhenNotMerchant() public {
        _createQuote();

        vm.prank(other);
        vm.expectRevert(PrivateMerchantQuote.NotAuthorized.selector);
        quote.grantAccess(quoteId, payer);
    }

    function test_CancelExpired_Success() public {
        _createQuote();

        vm.warp(block.timestamp + 2 days);

        vm.prank(merchant);
        quote.cancelExpired(quoteId);

        (, , , uint8 status, ) = quote.getQuote(quoteId);
        assertEq(status, 3);
    }

    function test_CancelQuote_Success() public {
        _createQuote();

        vm.prank(merchant);
        quote.cancelQuote(quoteId);

        (, , , uint8 status, ) = quote.getQuote(quoteId);
        assertEq(status, 3);
    }

    function test_GetEncryptedAmount_Success() public {
        bytes32 amountCt = _createQuote();

        bytes32 stored = quote.getEncryptedAmount(quoteId);
        assertEq(stored, amountCt);
    }
}
